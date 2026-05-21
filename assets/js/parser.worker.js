/* eslint-disable no-restricted-globals */
/**
 * Log parser Web Worker — all processing stays in the browser.
 */
importScripts('presets.js');

(function () {
  'use strict';

  var STATIC_EXT =
    /\.(css|js|mjs|map|jpg|jpeg|png|gif|ico|svg|webp|woff2?|ttf|eot|mp4|webm|pdf)(\?|$)/i;

  /** Combined Apache/Nginx: IP - - [date] "METHOD URL HTTP/x" STATUS SIZE "ref" "ua" */
  var COMBINED_RE =
    /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([^"]*)"\s+(\d{3})\s+(\S+)(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?\s*$/;

  function parseRequest(request) {
    var parts = request.trim().split(/\s+/);
    if (parts.length < 2) {
      return { method: '-', url: request || '-', protocol: '-' };
    }
    var method = parts[0];
    var protocol = parts.length > 2 ? parts[parts.length - 1] : '-';
    var url = parts.slice(1, parts.length > 2 ? -1 : undefined).join(' ') || '-';
    return { method: method, url: url, protocol: protocol };
  }

  function parseLine(line) {
    var trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === '#') {
      return { valid: false, skipped: true, raw: line };
    }

    var m = trimmed.match(COMBINED_RE);
    if (!m) {
      return { valid: false, skipped: false, raw: line, error: true };
    }

    var req = parseRequest(m[3]);
    var sizeRaw = m[5];
    var size = sizeRaw === '-' ? 0 : parseInt(sizeRaw, 10);
    if (isNaN(size)) size = 0;

    return {
      valid: true,
      ip: m[1],
      date: m[2],
      method: req.method,
      url: req.url,
      protocol: req.protocol,
      status: parseInt(m[4], 10),
      size: size,
      referrer: m[6] || '-',
      userAgent: m[7] || '-',
      raw: line,
    };
  }

  function isStaticRequest(row) {
    if (!row.valid) return false;
    if (row.method !== 'GET' && row.method !== 'HEAD') return false;
    return STATIC_EXT.test(row.url);
  }

  function applyPreset(rows, preset) {
    if (!preset || preset.mode === 'parse') return rows;
    if (preset.mode === 'filter' && typeof preset.filter === 'function') {
      return rows.filter(preset.filter);
    }
    return rows;
  }

  function countBy(rows, field, limit) {
    var map = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r.valid) continue;
      var key = r[field];
      if (key == null || key === '') key = '-';
      map[key] = (map[key] || 0) + 1;
    }
    var list = Object.keys(map).map(function (k) {
      return { key: k, count: map[k] };
    });
    list.sort(function (a, b) {
      return b.count - a.count;
    });
    return list.slice(0, limit || 20);
  }

  function buildSummary(rows) {
    var ips = Object.create(null);
    var s2 = 0;
    var s3 = 0;
    var s4 = 0;
    var s5 = 0;
    var staticCount = 0;
    var dynamicCount = 0;
    var valid = 0;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r.valid) continue;
      valid++;
      ips[r.ip] = true;
      var st = r.status;
      if (st >= 200 && st < 300) s2++;
      else if (st >= 300 && st < 400) s3++;
      else if (st >= 400 && st < 500) s4++;
      else if (st >= 500) s5++;

      if (isStaticRequest(r)) staticCount++;
      else dynamicCount++;
    }

    var uniqueIpCount = 0;
    for (var k in ips) {
      if (Object.prototype.hasOwnProperty.call(ips, k)) uniqueIpCount++;
    }

    return {
      totalRequests: valid,
      uniqueIPs: uniqueIpCount,
      status2xx: s2,
      status3xx: s3,
      status4xx: s4,
      status5xx: s5,
      staticRequests: staticCount,
      dynamicRequests: dynamicCount,
    };
  }

  function buildAnalytics(rows) {
    return {
      topIPs: countBy(rows, 'ip', 15),
      topURLs: countBy(rows, 'url', 15),
      statusDistribution: countBy(rows, 'status', 20),
      topUserAgents: countBy(rows, 'userAgent', 10),
      largestSizes: rows
        .filter(function (r) {
          return r.valid && r.size > 0;
        })
        .sort(function (a, b) {
          return b.size - a.size;
        })
        .slice(0, 10)
        .map(function (r) {
          return {
            key: r.url,
            count: r.size,
            ip: r.ip,
            status: r.status,
          };
        }),
    };
  }

  function parseContent(text, presetId) {
    var preset = AwkPresets.getPresetById(presetId || AwkPresets.defaultId);
    var lines = text.split(/\r?\n/);
    var total = lines.length;
    var rows = [];
    var errorCount = 0;
    var skippedCount = 0;
    var previewLimit = 500;
    var progressEvery = Math.max(500, Math.floor(total / 100));

    for (var i = 0; i < total; i++) {
      var parsed = parseLine(lines[i]);
      if (parsed.error) errorCount++;
      if (parsed.skipped) skippedCount++;
      rows.push(parsed);

      if (i % progressEvery === 0 || i === total - 1) {
        self.postMessage({
          type: 'progress',
          percent: total ? Math.round(((i + 1) / total) * 100) : 100,
          linesProcessed: i + 1,
          totalLines: total,
        });
      }
    }

    var filtered = applyPreset(
      rows.filter(function (r) {
        return r.valid;
      }),
      preset
    );

    var summary = buildSummary(rows);
    var analytics = buildAnalytics(rows);

    if (preset.mode === 'aggregate' && preset.aggregate) {
      var aggField = preset.aggregate;
      if (aggField === 'status') aggField = 'status';
      analytics.presetAggregate = countBy(filtered, aggField, 25);
    }

    var preview = filtered.slice(0, previewLimit);
    var exportLimit = 5000;
    var exportRows = filtered.slice(0, exportLimit);

    return {
      preset: preset,
      summary: summary,
      analytics: analytics,
      preview: preview,
      exportRows: exportRows,
      previewTotal: filtered.length,
      allValidCount: filtered.length,
      errorCount: errorCount,
      skippedCount: skippedCount,
      totalLines: total,
    };
  }

  self.onmessage = function (ev) {
    var data = ev.data || {};
    if (data.type !== 'parse') return;

    try {
      var result = parseContent(data.content || '', data.presetId);
      self.postMessage({
        type: 'complete',
        result: result,
      });
    } catch (err) {
      self.postMessage({
        type: 'error',
        message: err && err.message ? err.message : 'Parse failed',
      });
    }
  };
})();
