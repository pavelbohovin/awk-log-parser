/**
 * AWK Log Parser — SPA shell, hash routing, Web Worker orchestration.
 */
(function () {
  'use strict';

  var ROUTES = {
    '/': 'home',
    '/workspace': 'workspace',
    '/docs': 'docs',
    '/analytics': 'analytics',
  };

  var DEFAULT_AWK_SCRIPT =
    typeof AwkExamples !== 'undefined' ? AwkExamples.DEFAULT_SCRIPT : '';

  var state = {
    fileName: null,
    fileContent: null,
    presetId: AwkPresets.defaultId,
    engine: 'js',
    parsing: false,
    awkRunning: false,
    lastResult: null,
    lastAwkResult: null,
    worker: null,
    wasmAvailable: false,
    wasmMode: 'none',
    wasmError: null,
    wasmSelfTest: null,
    wasmStatusMessage: 'AWK WASM has not loaded yet.',
  };

  var els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatRoute(hash) {
    var path = (hash || '#/').replace(/^#/, '') || '/';
    if (path.charAt(0) !== '/') path = '/' + path;
    var q = path.indexOf('?');
    if (q !== -1) path = path.slice(0, q);
    if (path.length > 1 && path.slice(-1) === '/') path = path.slice(0, -1);
    return path in ROUTES ? path : '/';
  }

  function navigate(path, replace) {
    var target = '#/' + (path === '/' ? '' : path.replace(/^\//, ''));
    if (replace) {
      if (location.hash !== target) history.replaceState(null, '', target);
    } else if (location.hash !== target) {
      location.hash = target;
    }
    renderRoute(formatRoute(target));
  }

  function renderRoute(path) {
    var viewName = ROUTES[path] || 'home';
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('is-active', v.getAttribute('data-view') === viewName);
    });
    document.querySelectorAll('.nav-link').forEach(function (a) {
      var r = a.getAttribute('data-route');
      a.classList.toggle('is-active', r === path);
    });
    document.body.classList.toggle('workspace-layout', viewName === 'workspace');
    var footer = $('site-footer');
    if (footer) footer.hidden = viewName === 'workspace';

    if (viewName === 'analytics') renderAnalytics();
    if (viewName === 'docs') renderDocs();
  }

  function initWorker() {
    if (state.worker) return state.worker;
    try {
      state.worker = new Worker('assets/js/parser.worker.js');
    } catch (e) {
      console.error('Worker failed:', e);
      return null;
    }
    state.worker.onmessage = onWorkerMessage;
    state.worker.onerror = function (err) {
      state.parsing = false;
      setParsingUI(false);
      setProgressVisible(false);
      alert('Parser worker error: ' + (err.message || 'unknown'));
    };
    return state.worker;
  }

  function onWorkerMessage(ev) {
    var msg = ev.data || {};
    if (msg.type === 'awk-probe-result') {
      state.wasmAvailable = !!msg.available;
      state.wasmMode = msg.mode || 'none';
      state.wasmError = msg.error || null;
      state.wasmSelfTest = msg.selfTest || null;
      state.wasmStatusMessage = state.wasmAvailable
        ? 'AWK WASM Engine: Available'
        : 'AWK WASM Engine: Failed';
      updateWasmStatus();
      return;
    }
    if (msg.type === 'awk-status') {
      state.wasmStatusMessage = msg.message || state.wasmStatusMessage;
      if (msg.stderr) console.warn('AWK STDERR:', msg.stderr);
      updateWasmStatus();
      return;
    }
    if (msg.type === 'awk-result') {
      state.awkRunning = false;
      setAwkLoading(false);
      state.lastAwkResult = msg.result;
      if (msg.result && !msg.result.ok) {
        state.wasmError = msg.result.stderr || 'AWK execution failed.';
      }
      renderAwkResult(msg.result);
      return;
    }
    if (msg.type === 'progress') {
      setProgress(msg.percent, msg.linesProcessed, msg.totalLines);
      return;
    }
    if (msg.type === 'complete') {
      state.parsing = false;
      setParsingUI(false);
      setProgressVisible(false);
      state.lastResult = msg.result;
      var t1 = performance.now();
      applyResult(msg.result);
      var ms = Math.round(performance.now() - t1);
      var badge = $('exec-time-badge');
      if (badge) {
        badge.hidden = false;
        badge.textContent = ms + 'ms render';
      }
      return;
    }
    if (msg.type === 'error') {
      state.parsing = false;
      setParsingUI(false);
      setProgressVisible(false);
      alert(msg.message || 'Parse failed');
    }
  }

  function setProgress(percent, lines, total) {
    var fill = $('progress-fill');
    var label = $('progress-label');
    if (fill) fill.style.width = percent + '%';
    if (label) {
      label.textContent =
        'Parsing… ' + percent + '% (' + lines.toLocaleString() + ' / ' + total.toLocaleString() + ' lines)';
    }
  }

  function setProgressVisible(show) {
    var wrap = $('progress-wrap');
    if (wrap) wrap.classList.toggle('is-visible', show);
  }

  function setParsingUI(active) {
    var panel = $('results-panel');
    var loading = $('table-loading');
    var dot = $('live-dot');
    var label = $('loading-label');
    if (panel) panel.classList.toggle('is-loading', active);
    if (loading) loading.hidden = !active;
    if (label) label.textContent = 'Parsing log stream…';
    if (dot) dot.classList.toggle('is-live', active || !!(state.lastResult && state.lastResult.previewTotal));
  }

  function setAwkLoading(active) {
    var panel = $('awk-output-panel');
    var dot = $('awk-live-dot');
    if (panel) panel.classList.toggle('is-loading', active);
    if (dot) dot.classList.toggle('is-live', active);
  }

  function updateWasmStatus() {
    var el = $('wasm-status');
    if (!el) return;
    el.classList.remove('is-ok', 'is-warn', 'is-err');
    var selfTestText = 'Last WASM self-test result: not run';
    if (state.wasmSelfTest) {
      selfTestText =
        'Last WASM self-test result: ' +
        (state.wasmSelfTest.ok ? 'awk-wasm-ok' : 'failed') +
        ' (exit ' +
        (state.wasmSelfTest.exitCode != null ? state.wasmSelfTest.exitCode : 1) +
        ')';
    }
    if (!state.wasmAvailable) {
      el.classList.add(state.wasmError ? 'is-err' : 'is-warn');
      var msg =
        state.wasmError ||
        'AWK WASM files found but failed to load.';
      el.innerHTML =
        '<strong>Engine Status</strong><br>' +
        'JavaScript Parser: Available<br>' +
        'AWK WASM Engine: Failed<br>' +
        escapeHtml(selfTestText) +
        '<br>' +
        escapeHtml(msg) +
        '<br>Falling back to JavaScript parser.' +
        ' <button type="button" class="wasm-status__btn" id="use-js-parser-btn">Use JavaScript Parser</button>';
      var useJs = $('use-js-parser-btn');
      if (useJs && !useJs.dataset.bound) {
        useJs.dataset.bound = '1';
        useJs.addEventListener('click', function () {
          setEngine('js');
          if (state.fileContent) runParse();
        });
      }
      return;
    }
    el.innerHTML =
      '<strong>Engine Status</strong><br>' +
      'JavaScript Parser: Available<br>' +
      'AWK WASM Engine: Available (' +
      escapeHtml(state.wasmMode) +
      ')<br>' +
      escapeHtml(selfTestText) +
      '<br>' +
      escapeHtml(state.wasmStatusMessage || 'AWK WASM loaded.');
    el.classList.add('is-ok');
  }

  function setEngine(engine) {
    state.engine = engine === 'wasm' ? 'wasm' : 'js';
    var sel = $('engine-select');
    if (sel) sel.value = state.engine;

    var jsPanel = $('panel-js-engine');
    var wasmPanel = $('panel-wasm-engine');
    var jsResults = $('results-panel');
    var awkResults = $('awk-output-panel');
    var jsSide = $('side-js-presets');
    var summary = $('summary-grid');
    var progress = $('progress-wrap');

    if (jsPanel) jsPanel.hidden = state.engine !== 'js';
    if (wasmPanel) wasmPanel.hidden = state.engine !== 'wasm';
    if (jsResults) jsResults.hidden = state.engine !== 'js';
    if (awkResults) awkResults.hidden = state.engine !== 'wasm';
    if (jsSide) jsSide.hidden = state.engine !== 'js';
    if (summary) summary.hidden = state.engine === 'wasm';

    var grid = document.querySelector('.workspace-grid');
    if (grid) {
      grid.classList.toggle('workspace-grid--js', state.engine === 'js');
      grid.classList.toggle('workspace-grid--wasm', state.engine === 'wasm');
    }
    if (progress && state.engine === 'wasm' && !state.parsing) {
      progress.classList.remove('is-visible');
    }

    if (state.engine === 'wasm' && !state.wasmAvailable) {
      updateWasmStatus();
    }

    syncEngineButtons();
  }

  function syncEngineButtons() {
    var hasLog = !!state.fileContent;
    var runParse = $('run-parse-btn');
    var runAwk = $('run-awk-btn');
    if (runParse) runParse.disabled = !hasLog || state.parsing || state.engine !== 'js';
    if (runAwk) {
      runAwk.disabled =
        !hasLog || state.awkRunning || state.engine !== 'wasm' || !state.wasmAvailable;
      runAwk.title = !state.wasmAvailable
        ? 'Deploy assets/wasm/awk.js and awk.wasm (see assets/wasm/README.md)'
        : '';
    }
  }

  function probeWasm() {
    var worker = initWorker();
    if (worker) worker.postMessage({ type: 'awk-probe' });
  }

  function parseCsvStdout(stdout) {
    var lines = (stdout || '').split(/\r?\n/).filter(function (l) {
      return l.trim().length > 0;
    });
    if (lines.length < 2) return null;

    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].split(',');
      if (parts.length < 2) return null;
      rows.push(parts.map(function (c) {
        return c.trim();
      }));
    }

    var cols = rows[0].length;
    for (var j = 1; j < rows.length; j++) {
      if (rows[j].length !== cols) return null;
    }

    return { headers: rows[0], rows: rows.slice(1) };
  }

  function renderAwkResult(result) {
    result = result || { ok: false, stdout: '', stderr: '', exitCode: 1 };
    var stdoutPre = $('awk-stdout-pre');
    var stderrPanel = $('awk-stderr-panel');
    var stderrPre = $('awk-stderr-pre');
    var exitBadge = $('awk-exit-badge');
    var csvSection = $('awk-csv-section');
    var thead = $('awk-csv-thead');
    var tbody = $('awk-csv-tbody');

    if (stdoutPre) {
      stdoutPre.textContent = result.stdout && result.stdout.trim() ? result.stdout : '(empty)';
    }
    if (stderrPanel && stderrPre) {
      var hasErr = !!(result.stderr && result.stderr.trim());
      stderrPanel.hidden = !hasErr;
      stderrPre.textContent = result.stderr || '';
    }
    if (exitBadge) {
      exitBadge.textContent = result.ok ? 'exit 0' : 'exit ' + (result.exitCode != null ? result.exitCode : 1);
      exitBadge.style.color = result.ok ? 'var(--secondary)' : 'var(--error)';
    }

    var csv = result.ok ? parseCsvStdout(result.stdout) : null;
    if (csvSection && thead && tbody) {
      if (csv && csv.rows.length) {
        csvSection.hidden = false;
        thead.innerHTML =
          '<tr>' +
          csv.headers
            .map(function (h) {
              return '<th scope="col">' + escapeHtml(h) + '</th>';
            })
            .join('') +
          '</tr>';
        var html = '';
        for (var i = 0; i < Math.min(csv.rows.length, 500); i++) {
          html += '<tr>';
          for (var c = 0; c < csv.rows[i].length; c++) {
            html += '<td>' + escapeHtml(csv.rows[i][c]) + '</td>';
          }
          html += '</tr>';
        }
        tbody.innerHTML = html;
      } else {
        csvSection.hidden = true;
        thead.innerHTML = '';
        tbody.innerHTML = '';
      }
    }

  }

  function showWasmUnavailableInline() {
    var msg =
      state.wasmError ||
      'AWK WASM files found but failed to load.';
    renderAwkResult({
      ok: false,
      stdout: '',
      stderr: msg + '\nFalling back to JavaScript parser.',
      exitCode: 1,
    });
    updateWasmStatus();
  }

  function runAwk() {
    if (!state.fileContent || state.awkRunning) return;

    if (!state.wasmAvailable) {
      showWasmUnavailableInline();
      return;
    }

    var editor = $('awk-script-editor');
    var script = editor ? editor.value : DEFAULT_AWK_SCRIPT;
    var worker = initWorker();
    if (!worker) {
      alert('Web Workers are not available.');
      return;
    }

    state.awkRunning = true;
    setAwkLoading(true);
    var stdoutPre = $('awk-stdout-pre');
    if (stdoutPre) stdoutPre.textContent = 'Running AWK in Web Worker…';

    worker.postMessage({
      type: 'run-awk',
      script: script,
      inputText: state.fileContent,
    });
  }

  function resetAwkScript() {
    var editor = $('awk-script-editor');
    if (editor) editor.value = DEFAULT_AWK_SCRIPT;
  }

  function buildAwkExampleSelect() {
    var sel = $('awk-example-select');
    if (!sel || typeof AwkExamples === 'undefined') return;
    var html = '<option value="">Load example script…</option>';
    AwkExamples.EXAMPLES.forEach(function (ex) {
      html += '<option value="' + escapeHtml(ex.id) + '">' + escapeHtml(ex.name) + '</option>';
    });
    sel.innerHTML = html;
  }

  function setTableEmptyVisible(show) {
    var empty = $('table-empty');
    var table = $('preview-table');
    if (empty) empty.classList.toggle('is-hidden', !show);
    if (table) table.classList.toggle('is-hidden', show);
  }

  function updateCodePreview() {
    var preset = AwkPresets.getPresetById(state.presetId);
    var cmdEl = $('awk-preview-cmd');
    var titleEl = $('terminal-title');
    var linesEl = $('log-preview-lines');

    if (cmdEl && preset) {
      cmdEl.textContent = preset.awkSample.split('\n')[0];
    }
    if (titleEl) {
      titleEl.textContent = state.fileName
        ? 'query.awk — ' + state.fileName
        : 'query.awk — awaiting log';
    }
    if (!linesEl) return;

    if (!state.fileContent) {
      linesEl.innerHTML =
        '<div class="terminal-line terminal-line--dim"><span class="ln">·</span><code class="dim">No lines loaded yet.</code></div>';
      return;
    }

    var rawLines = state.fileContent.split(/\r?\n/).filter(function (l) {
      return l.trim().length > 0;
    });
    var max = 8;
    var html = '';
    for (var i = 0; i < Math.min(max, rawLines.length); i++) {
      var line = rawLines[i];
      var cls = 'dim';
      if (/\s(4\d{2}|5\d{2})\s/.test(line) || /\s(4\d{2}|5\d{2})"/.test(line)) cls = 'err';
      else if (/\s2\d{2}\s/.test(line)) cls = 'ok';
      else if (/\s3\d{2}\s/.test(line)) cls = 'warn';
      html +=
        '<div class="terminal-line"><span class="ln">' +
        (i + 1) +
        '</span><code class="' +
        cls +
        '">' +
        escapeHtml(line.length > 96 ? line.slice(0, 93) + '…' : line) +
        '</code></div>';
    }
    if (rawLines.length > max) {
      html +=
        '<div class="terminal-line terminal-line--dim"><span class="ln">…</span><code class="dim">' +
        escapeHtml('+' + (rawLines.length - max) + ' more lines') +
        '</code></div>';
    }
    linesEl.innerHTML = html;
  }

  function loadSampleLog() {
    if (typeof AwkSampleLog === 'undefined') return;
    state.fileName = AwkSampleLog.name;
    state.fileContent = AwkSampleLog.content;
    var meta = $('file-meta');
    var dropzone = $('dropzone');
    if (meta) {
      meta.hidden = false;
      meta.textContent =
        AwkSampleLog.name +
        ' · ' +
        (AwkSampleLog.content.length / 1024).toFixed(1) +
        ' KB · ' +
        AwkSampleLog.lineCount +
        ' lines (sample)';
    }
    if (dropzone) dropzone.classList.add('has-file');
    updateCodePreview();
    enableExport(false);
    syncEngineButtons();
    navigate('/workspace');
    if (state.engine === 'js') runParse();
  }

  function ingestContent(name, content, isSample) {
    state.fileName = name;
    state.fileContent = content;
    var meta = $('file-meta');
    var dropzone = $('dropzone');
    if (meta) {
      meta.hidden = false;
      meta.textContent =
        name +
        ' · ' +
        (content.length / 1024).toFixed(1) +
        ' KB' +
        (isSample ? ' · sample data' : ' · ready to parse');
    }
    if (dropzone) dropzone.classList.add('has-file');
    updateCodePreview();
    enableExport(false);
    syncEngineButtons();
  }

  function runParse() {
    if (!state.fileContent || state.parsing) return;
    var worker = initWorker();
    if (!worker) {
      alert('Web Workers are not available in this environment.');
      return;
    }
    state.parsing = true;
    setParsingUI(true);
    setProgressVisible(true);
    setProgress(0, 0, 0);
    setTableEmptyVisible(false);

    worker.postMessage({
      type: 'parse',
      content: state.fileContent,
      presetId: state.presetId,
    });
  }

  function applyResult(result) {
    if (!result) return;
    updateSummary(result.summary, result.errorCount);
    renderPreviewTable(result.preview, result.previewTotal);
    renderAnalyticsData(result.analytics);
    enableExport(true);
  }

  function updateSummary(summary, errors) {
    summary = summary || {};
    $('stat-total').textContent = summary.totalRequests ?? '—';
    $('stat-ips').textContent = summary.uniqueIPs ?? '—';
    $('stat-status').textContent =
      [summary.status2xx, summary.status3xx, summary.status4xx, summary.status5xx].join(
        ' / '
      ) || '—';
    $('stat-static').textContent =
      (summary.staticRequests ?? 0) + ' / ' + (summary.dynamicRequests ?? 0);
    $('stat-errors').textContent = errors != null ? errors : '—';
  }

  function statusPillClass(code) {
    if (code >= 500) return 'status-pill--err';
    if (code >= 400) return 'status-pill--warn';
    if (code >= 200 && code < 400) return 'status-pill--ok';
    return '';
  }

  function renderPreviewTable(rows, total) {
    var tbody = $('preview-tbody');
    var badge = $('row-count-badge');
    if (!tbody) return;
    rows = rows || [];
    total = total != null ? total : rows.length;
    if (badge) {
      badge.textContent =
        total.toLocaleString() + ' rows' + (rows.length < total ? ' (preview)' : '');
    }

    setParsingUI(false);

    if (!rows.length) {
      tbody.innerHTML = '';
      setTableEmptyVisible(true);
      var empty = $('table-empty');
      if (empty) {
        var h = empty.querySelector('h4');
        var p = empty.querySelector('p');
        if (h) h.textContent = state.fileContent ? 'No matching rows' : 'No parsed rows yet';
        if (p) {
          p.textContent = state.fileContent
            ? 'Try a different preset or check that your log uses combined Apache/Nginx format.'
            : 'Upload an access log or load the bundled sample to run the parser in a Web Worker.';
        }
      }
      return;
    }

    setTableEmptyVisible(false);
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var pillCls = statusPillClass(r.status);
      html +=
        '<tr>' +
        '<td>' +
        escapeHtml(('0' + (i + 1).toString(16)).slice(-2)) +
        '</td>' +
        '<td class="col-ip">' +
        escapeHtml(r.ip) +
        '</td>' +
        '<td>' +
        escapeHtml(r.date) +
        '</td>' +
        '<td>' +
        escapeHtml(r.method) +
        '</td>' +
        '<td class="col-url" title="' +
        escapeHtml(r.url) +
        '">' +
        escapeHtml(r.url) +
        '</td>' +
        '<td><span class="status-pill ' +
        pillCls +
        '">' +
        escapeHtml(r.status) +
        '</span></td>' +
        '<td>' +
        escapeHtml(r.size != null ? r.size.toLocaleString() : '—') +
        '</td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
  }

  function maxCount(items) {
    var m = 1;
    for (var i = 0; i < items.length; i++) {
      if (items[i].count > m) m = items[i].count;
    }
    return m;
  }

  function barChartHtml(title, items, fillClass) {
    if (!items || !items.length) {
      return (
        '<article class="chart-card"><h3>' +
        escapeHtml(title) +
        '</h3><div class="empty-panel" style="min-height:120px;padding:var(--space-lg)">' +
        '<p class="empty-state" style="padding:0">No data for this chart</p></div></article>'
      );
    }
    var max = maxCount(items);
    var rows = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var pct = Math.round((it.count / max) * 100);
      var key = it.key != null ? String(it.key) : '-';
      if (key.length > 48) key = key.slice(0, 45) + '…';
      rows +=
        '<div class="bar-row">' +
        '<span class="bar-label" title="' +
        escapeHtml(String(it.key)) +
        '">' +
        escapeHtml(key) +
        '</span>' +
        '<div class="bar-track"><div class="bar-fill ' +
        (fillClass || '') +
        '" style="width:' +
        pct +
        '%"></div></div>' +
        '<span class="bar-count">' +
        escapeHtml(it.count) +
        '</span></div>';
    }
    return (
      '<article class="chart-card"><h3>' +
      escapeHtml(title) +
      '</h3><div class="bar-chart">' +
      rows +
      '</div></article>'
    );
  }

  function renderAnalyticsData(analytics) {
    if (!analytics) return;
    state._analyticsCache = analytics;
    if (formatRoute(location.hash) === 'analytics') renderAnalytics();
  }

  function renderAnalytics() {
    var root = $('analytics-root');
    var empty = $('analytics-empty');
    var a = state._analyticsCache || (state.lastResult && state.lastResult.analytics);
    if (!a) {
      if (root) {
        root.innerHTML = '';
        if (empty) {
          empty.classList.remove('is-hidden');
          root.appendChild(empty);
        }
      }
      return;
    }
    if (empty) empty.classList.add('is-hidden');

    var html = '';
    html += barChartHtml('Top IPs', a.topIPs, '');
    html += barChartHtml('Top URLs', a.topURLs, 'bar-fill--secondary');
    html += barChartHtml('Status code distribution', a.statusDistribution, 'bar-fill--tertiary');
    html += barChartHtml('Top user agents', a.topUserAgents, '');
    html += barChartHtml(
      'Largest response sizes (bytes)',
      (a.largestSizes || []).map(function (x) {
        return { key: x.key + ' (' + x.status + ')', count: x.count };
      }),
      'bar-fill--secondary'
    );

    if (a.presetAggregate && a.presetAggregate.length) {
      html += barChartHtml('Preset aggregate', a.presetAggregate, '');
    }

    root.innerHTML = html;
  }

  function renderDocs() {
    var grid = $('preset-docs-grid');
    if (!grid || grid.dataset.built) return;
    grid.dataset.built = '1';
    var html = '';
    AwkPresets.PRESETS.forEach(function (p) {
      html +=
        '<article class="preset-doc-card">' +
        '<h3>' +
        escapeHtml(p.name) +
        '</h3>' +
        '<p>' +
        escapeHtml(p.description) +
        '</p>' +
        '<p class="label-caps" style="margin-top:var(--space-md);color:var(--on-surface-variant);">Reference AWK</p>' +
        '<pre>' +
        escapeHtml(p.awkSample) +
        '</pre>' +
        '</article>';
    });
    grid.innerHTML = html;
  }

  function buildPresetUI() {
    var select = $('preset-select');
    var quick = $('preset-quick-list');
    if (!select || !quick) return;

    var opts = '';
    var quickHtml = '';
    AwkPresets.PRESETS.forEach(function (p) {
      opts += '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) + '</option>';
      quickHtml +=
        '<button type="button" class="preset-quick-btn" data-preset="' +
        escapeHtml(p.id) +
        '" aria-pressed="false">' +
        '<span class="preset-icon" aria-hidden="true">⌘</span>' +
        '<span><span class="label-caps" style="color:var(--on-surface);display:block;">' +
        escapeHtml(p.name) +
        '</span>' +
        '<span style="font-family:var(--font-mono);font-size:12px;color:var(--on-surface-variant);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;">' +
        escapeHtml(p.awkSample.split('\n')[0]) +
        '</span></span></button>';
    });
    select.innerHTML = opts;
    quick.innerHTML = quickHtml;
    select.value = state.presetId;
    syncPresetSelection();
  }

  function syncPresetSelection() {
    document.querySelectorAll('.preset-quick-btn').forEach(function (btn) {
      var on = btn.getAttribute('data-preset') === state.presetId;
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var select = $('preset-select');
    if (select) select.value = state.presetId;
  }

  function setPreset(id) {
    state.presetId = id;
    syncPresetSelection();
    updateCodePreview();
    if (state.fileContent) runParse();
  }

  function enableExport(on) {
    ['export-csv-btn', 'export-csv-header'].forEach(function (id) {
      var b = $(id);
      if (b) b.disabled = !on;
    });
    syncEngineButtons();
  }

  function exportCsv() {
    var result = state.lastResult;
    var rows = (result && (result.exportRows || result.preview)) || [];
    if (!rows.length) return;

    var headers = ['ip', 'date', 'method', 'url', 'protocol', 'status', 'size', 'referrer', 'userAgent'];
    var lines = [headers.join(',')];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var cells = headers.map(function (h) {
        var v = r[h] != null ? String(r[h]) : '';
        if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
        return v;
      });
      lines.push(cells.join(','));
    }
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.fileName || 'log') + '-export.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function readFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      ingestContent(file.name, reader.result, false);
      navigate('/workspace');
      if (state.engine === 'js') runParse();
    };
    reader.onerror = function () {
      alert('Could not read file.');
    };
    reader.readAsText(file);
  }

  function onFileInput(fileList) {
    if (fileList && fileList[0]) readFile(fileList[0]);
  }

  function bindEvents() {
    window.addEventListener('hashchange', function () {
      renderRoute(formatRoute(location.hash));
    });

    document.querySelectorAll('[data-go-workspace]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        navigate('/workspace');
        $('file-input').click();
      });
    });

    var menuToggle = $('menu-toggle');
    var mobileNav = $('mobile-nav');
    if (menuToggle && mobileNav) {
      menuToggle.addEventListener('click', function () {
        var open = mobileNav.classList.toggle('is-open');
        menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      mobileNav.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () {
          mobileNav.classList.remove('is-open');
          menuToggle.setAttribute('aria-expanded', 'false');
        });
      });
    }

    var fileInput = $('file-input');
    var chooseBtn = $('choose-file-btn');
    var dropzone = $('dropzone');

    if (chooseBtn && fileInput) {
      chooseBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        fileInput.click();
      });
    }
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        onFileInput(fileInput.files);
        fileInput.value = '';
      });
    }
    if (dropzone) {
      dropzone.addEventListener('click', function () {
        fileInput.click();
      });
      dropzone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInput.click();
        }
      });
      dropzone.addEventListener('dragover', function (e) {
        e.preventDefault();
        dropzone.classList.add('is-dragover');
      });
      dropzone.addEventListener('dragleave', function () {
        dropzone.classList.remove('is-dragover');
      });
      dropzone.addEventListener('drop', function (e) {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
        onFileInput(e.dataTransfer.files);
      });
    }

    $('preset-select').addEventListener('change', function () {
      setPreset(this.value);
    });

    $('preset-quick-list').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-preset]');
      if (btn) setPreset(btn.getAttribute('data-preset'));
    });

    $('run-parse-btn').addEventListener('click', runParse);
    $('export-csv-btn').addEventListener('click', exportCsv);
    $('export-csv-header').addEventListener('click', exportCsv);

    var engineSelect = $('engine-select');
    if (engineSelect) {
      engineSelect.addEventListener('change', function () {
        setEngine(this.value);
        if (this.value === 'wasm' && !state.wasmAvailable) {
          probeWasm();
        }
      });
    }

    var runAwkBtn = $('run-awk-btn');
    if (runAwkBtn) runAwkBtn.addEventListener('click', runAwk);

    var resetAwkBtn = $('reset-awk-btn');
    if (resetAwkBtn) resetAwkBtn.addEventListener('click', resetAwkScript);

    var awkExampleSel = $('awk-example-select');
    if (awkExampleSel) {
      awkExampleSel.addEventListener('change', function () {
        var id = this.value;
        if (!id || typeof AwkExamples === 'undefined') return;
        var ex = AwkExamples.getById(id);
        if (ex) {
          var editor = $('awk-script-editor');
          if (editor) editor.value = ex.script;
        }
        this.value = '';
      });
    }

    var sampleBtn = $('sample-log-btn');
    if (sampleBtn) {
      sampleBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        loadSampleLog();
      });
    }
    var tableSample = $('table-empty-sample');
    if (tableSample) {
      tableSample.addEventListener('click', function (e) {
        e.preventDefault();
        loadSampleLog();
      });
    }

    window.addEventListener('scroll', function () {
      var header = document.querySelector('.site-header');
      if (header) header.classList.toggle('is-scrolled', window.scrollY > 12);
    });
  }

  function init() {
    buildPresetUI();
    buildAwkExampleSelect();
    var editor = $('awk-script-editor');
    if (editor) editor.value = DEFAULT_AWK_SCRIPT;
    bindEvents();
    if (!location.hash || location.hash === '#') {
      navigate('/', true);
    } else {
      renderRoute(formatRoute(location.hash));
    }
    setEngine('js');
    enableExport(false);
    setTableEmptyVisible(true);
    setParsingUI(false);
    setAwkLoading(false);
    updateCodePreview();
    renderDocs();
    probeWasm();
  }

  /**
   * Public API — AWK runs in parser.worker.js; these methods delegate to the worker.
   */
  window.AwkWasm = {
    isSupported: function () {
      return typeof WebAssembly !== 'undefined';
    },
    isLoaded: function () {
      return state.wasmAvailable;
    },
    load: function () {
      return new Promise(function (resolve) {
        var worker = initWorker();
        if (!worker) {
          resolve(false);
          return;
        }
        var onProbe = function (ev) {
          if (ev.data && ev.data.type === 'awk-probe-result') {
            state.worker.removeEventListener('message', onProbe);
            resolve(!!ev.data.available);
          }
        };
        state.worker.addEventListener('message', onProbe);
        worker.postMessage({ type: 'awk-probe' });
      });
    },
    run: function (script, inputText) {
      return new Promise(function (resolve, reject) {
        var worker = initWorker();
        if (!worker) {
          reject(new Error('Worker unavailable'));
          return;
        }
        var onResult = function (ev) {
          if (ev.data && ev.data.type === 'awk-result') {
            state.worker.removeEventListener('message', onResult);
            resolve(ev.data.result);
          }
        };
        state.worker.addEventListener('message', onResult);
        worker.postMessage({
          type: 'run-awk',
          script: script,
          inputText: inputText || '',
        });
      });
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
