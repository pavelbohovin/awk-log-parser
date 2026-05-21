/**
 * AWK WASM loader — runs inside parser.worker.js.
 *
 * Build output (Emscripten, MODULARIZE=1):
 *   assets/wasm/awk.js   -> global AwkModule(factory) => Promise<Module>
 *   assets/wasm/awk.wasm
 *
 * Run: awk -f /script.awk /input.log via Module.FS + Module.callMain.
 */
(function (global) {
  'use strict';

  var AWK_JS_NAME = 'awk.js';
  var AWK_WASM_NAME = 'awk.wasm';
  var INPUT_LOG = '/input.log';
  var SCRIPT_AWK = '/script.awk';

  var loaded = false;
  var loading = null;
  var lastError = null;
  var lastSelfTest = null;
  var mode = 'none';
  var factory = null;
  var paths = resolvePaths();

  function log() {
    if (typeof console !== 'undefined' && console.debug) {
      console.debug.apply(console, ['[AwkWasm]'].concat([].slice.call(arguments)));
    }
  }

  function warn() {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn.apply(console, ['[AwkWasm]'].concat([].slice.call(arguments)));
    }
  }

  function isSupported() {
    return typeof WebAssembly !== 'undefined';
  }

  function isLoaded() {
    return loaded;
  }

  function getLastError() {
    return lastError;
  }

  function getLastSelfTest() {
    return lastSelfTest;
  }

  function getMode() {
    return mode;
  }

  function stripFileName(url) {
    return String(url || '').replace(/[#?].*$/, '').replace(/\/[^/]*$/, '/');
  }

  function resolvePaths() {
    var href =
      (global && global.location && global.location.href) ||
      (typeof location !== 'undefined' && location.href) ||
      '';

    try {
      var jsUrl = new URL('../wasm/' + AWK_JS_NAME, href || document.baseURI).href;
      return {
        baseUrl: new URL('../wasm/', href || document.baseURI).href,
        jsUrl: jsUrl,
        wasmUrl: new URL('../wasm/' + AWK_WASM_NAME, href || document.baseURI).href,
      };
    } catch (e) {
      var base = stripFileName(href) + '../wasm/';
      return {
        baseUrl: base,
        jsUrl: base + AWK_JS_NAME,
        wasmUrl: base + AWK_WASM_NAME,
      };
    }
  }

  function result(ok, stdout, stderr, exitCode) {
    return {
      ok: !!ok,
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: exitCode == null ? (ok ? 0 : 1) : exitCode,
    };
  }

  function failResult(stderr, exitCode) {
    return result(false, '', stderr || 'AWK WASM not available', exitCode);
  }

  function extractExitCode(err, fallback) {
    if (!err) return fallback;
    if (typeof err.status === 'number') return err.status;
    if (typeof err.exitCode === 'number') return err.exitCode;
    var message = err.message || String(err);
    var m = message.match(/exit\((\d+)\)|status:?\s*(\d+)/i);
    if (m) return parseInt(m[1] || m[2], 10);
    return fallback;
  }

  function errorText(err) {
    if (!err) return '';
    return err.message || String(err);
  }

  function importAwkGlue() {
    if (typeof importScripts !== 'function') {
      throw new Error('AWK WASM must be loaded from a Web Worker.');
    }
    log('AWK WASM loading started');
    log('awk.js path:', paths.jsUrl);
    log('awk.wasm path:', paths.wasmUrl);
    importScripts(paths.jsUrl);
    factory = global.AwkModule;
    if (typeof factory !== 'function') {
      throw new Error(
        'awk.js loaded but AwkModule factory is missing. Rebuild with MODULARIZE=1 and EXPORT_NAME=AwkModule.'
      );
    }
  }

  function createModule(capture) {
    if (!factory) importAwkGlue();
    return factory({
      thisProgram: 'awk',
      noInitialRun: true,
      noExitRuntime: true,
      locateFile: function (path) {
        if (/^https?:\/\//i.test(path) || path.indexOf('file:') === 0) return path;
        if (path.slice(-5) === '.wasm') return paths.wasmUrl;
        return paths.baseUrl + path;
      },
      print: function (text) {
        capture.stdout.push(String(text));
      },
      printErr: function (text) {
        capture.stderr.push(String(text));
      },
    });
  }

  function cleanStderr(stderr) {
    return String(stderr || '')
      .replace(/\n?program exited \(with status:[^\n]*\n?/g, '\n')
      .trim();
  }

  function runOnFreshModule(script, inputText) {
    var capture = { stdout: [], stderr: [] };

    log('AWK run started');
    return createModule(capture)
      .then(function (Module) {
        if (!Module || !Module.FS) {
          return failResult('Emscripten module missing FS API. Rebuild with FORCE_FILESYSTEM=1.', 1);
        }
        if (typeof Module.callMain !== 'function') {
          return failResult(
            'awk.wasm loaded but Module.callMain is missing. Rebuild with EXPORTED_RUNTIME_METHODS including callMain.',
            1
          );
        }

        Module.FS.writeFile(SCRIPT_AWK, script || '');
        Module.FS.writeFile(INPUT_LOG, inputText || '');

        var exitCode = 0;
        try {
          exitCode = Module.callMain(['-f', SCRIPT_AWK, INPUT_LOG]) | 0;
        } catch (err) {
          exitCode = extractExitCode(err, 1);
          var caughtErr = errorText(err);
          if (caughtErr && capture.stderr.indexOf(caughtErr) === -1) {
            capture.stderr.push(caughtErr);
          }
        }

        var stdout = capture.stdout.length ? capture.stdout.join('\n') + '\n' : '';
        var stderr = cleanStderr(capture.stderr.join('\n'));
        if (stderr) warn('stderr:', stderr);
        log('AWK run finished', { exitCode: exitCode });
        return result(exitCode === 0, stdout, stderr, exitCode);
      })
      .catch(function (err) {
        lastError = errorText(err);
        warn('AWK execution failed:', lastError);
        return failResult(lastError || 'AWK execution failed.', extractExitCode(err, 1));
      });
  }

  function runSelfTest() {
    return runOnFreshModule('BEGIN {\n  print "awk-wasm-ok"\n}\n', '').then(function (res) {
      var normalized = String(res.stdout || '').trim();
      lastSelfTest = {
        ok: !!res.ok && normalized === 'awk-wasm-ok',
        stdout: res.stdout,
        stderr: res.stderr,
        exitCode: res.exitCode,
      };
      if (!lastSelfTest.ok) {
        lastError =
          'AWK WASM files found but self-test failed. Expected "awk-wasm-ok", got "' +
          normalized +
          '".' +
          (res.stderr ? ' STDERR: ' + res.stderr : '');
      }
      return lastSelfTest.ok;
    });
  }

  function load() {
    if (loaded) return Promise.resolve(true);
    if (loading) return loading;
    if (!isSupported()) {
      lastError = 'WebAssembly is not supported in this browser.';
      return Promise.resolve(false);
    }

    loading = Promise.resolve()
      .then(function () {
        if (!factory) importAwkGlue();
        mode = 'emscripten';
        return runSelfTest();
      })
      .then(function (ok) {
        loaded = !!ok;
        if (loaded) {
          lastError = null;
          log('AWK WASM loaded');
        } else if (!lastError) {
          lastError = 'AWK WASM files found but failed to load.';
        }
        loading = null;
        return loaded;
      })
      .catch(function (err) {
        loaded = false;
        mode = 'none';
        lastError = 'AWK WASM files found but failed to load. ' + errorText(err);
        lastSelfTest = {
          ok: false,
          stdout: '',
          stderr: lastError,
          exitCode: extractExitCode(err, 1),
        };
        warn(lastError);
        loading = null;
        return false;
      });

    return loading;
  }

  function run(script, inputText) {
    return load().then(function (ok) {
      if (!ok) return failResult(lastError || 'AWK WASM files found but failed to load.', 1);
      return runOnFreshModule(script, inputText);
    });
  }

  var api = {
    isSupported: isSupported,
    isLoaded: isLoaded,
    getLastError: getLastError,
    getLastSelfTest: getLastSelfTest,
    getMode: getMode,
    load: load,
    run: run,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.AwkWasm = api;
})(typeof self !== 'undefined' ? self : globalThis);
