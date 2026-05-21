/**
 * AWK WASM loader — runs in main thread or Web Worker.
 *
 * Loading order:
 *   A) Emscripten: assets/wasm/awk.js + awk.wasm (virtual FS, callMain)
 *   B) Raw wasm only: assets/wasm/awk.wasm (no stdin bridge — explicit error)
 *
 * Limitations without a compiled binary: load() fails gracefully; app uses JS parser.
 */
(function (global) {
  'use strict';

  var loaded = false;
  var loading = null;
  var lastError = null;
  /** @type {'none'|'emscripten'|'raw'} */
  var mode = 'none';

  var INPUT_LOG = '/input.log';
  var SCRIPT_AWK = '/script.awk';

  function isSupported() {
    return typeof WebAssembly !== 'undefined';
  }

  function isLoaded() {
    return loaded;
  }

  function getLastError() {
    return lastError;
  }

  function getMode() {
    return mode;
  }

  /**
   * Base URL for wasm assets (trailing slash).
   * Worker: .../assets/js/parser.worker.js → .../assets/wasm/
   */
  function wasmBaseUrl() {
    var href =
      (typeof self !== 'undefined' && self.location && self.location.href) ||
      (typeof location !== 'undefined' && location.href) ||
      '';
    if (href.indexOf('/assets/js/') !== -1) {
      return href.replace(/\/assets\/js\/[^?#]+$/, '/assets/wasm/');
    }
    if (href) {
      var u = href.replace(/[#?].*$/, '').replace(/\/[^/]*$/, '');
      return u + '/assets/wasm/';
    }
    return 'assets/wasm/';
  }

  function failResult(stderr, exitCode) {
    return {
      ok: false,
      stdout: '',
      stderr: stderr || 'AWK WASM not available',
      exitCode: exitCode != null ? exitCode : 1,
    };
  }

  function okResult(stdout, stderr, exitCode) {
    return {
      ok: exitCode === 0,
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: exitCode != null ? exitCode : 0,
    };
  }

  function fetchExists(url) {
    return fetch(url, { method: 'HEAD', cache: 'no-cache' })
      .then(function (res) {
        return res.ok;
      })
      .catch(function () {
        return false;
      });
  }

  function waitRuntimeInitialized(Module) {
    return new Promise(function (resolve, reject) {
      if (Module.calledRun || Module.asm) {
        resolve(Module);
        return;
      }
      var prev = Module.onRuntimeInitialized;
      Module.onRuntimeInitialized = function () {
        if (typeof prev === 'function') prev();
        resolve(Module);
      };
      setTimeout(function () {
        if (Module.asm || Module.FS) resolve(Module);
        else reject(new Error('WASM runtime initialization timed out'));
      }, 120000);
    });
  }

  /**
   * Configure Module before Emscripten glue executes (importScripts).
   */
  function createPreModule(baseUrl) {
    var capture = { out: '', err: '' };
    var Module = {
      noInitialRun: true,
      locateFile: function (path) {
        if (path.indexOf('http') === 0) return path;
        return baseUrl + path;
      },
      print: function (text) {
        capture.out += text + '\n';
      },
      printErr: function (text) {
        capture.err += text + '\n';
      },
      capture: capture,
    };
    return Module;
  }

  function loadEmscripten(baseUrl) {
    return fetchExists(baseUrl + 'awk.js').then(function (exists) {
      if (!exists) return false;
      var Module = createPreModule(baseUrl);
      global.Module = Module;
      try {
        // Relative to assets/js/parser.worker.js
        importScripts('../wasm/awk.js');
      } catch (e1) {
        lastError = 'Failed to load awk.js: ' + (e1.message || e1);
        return false;
      }
      var M = global.Module || Module;
      global.Module = M;
      return waitRuntimeInitialized(M)
        .then(function () {
          mode = 'emscripten';
          loaded = true;
          lastError = null;
          return true;
        })
        .catch(function (err) {
          lastError = err.message || String(err);
          return false;
        });
    });
  }

  /**
   * Path B: raw .wasm only — instantiate but no I/O bridge.
   */
  function loadRawWasm(baseUrl) {
    return fetchExists(baseUrl + 'awk.wasm').then(function (exists) {
      if (!exists) return false;
      var wasmUrl = baseUrl + 'awk.wasm';
      var instantiate = WebAssembly.instantiateStreaming
        ? WebAssembly.instantiateStreaming(fetch(wasmUrl), {})
        : fetch(wasmUrl)
            .then(function (r) {
              return r.arrayBuffer();
            })
            .then(function (buf) {
              return WebAssembly.instantiate(buf, {});
            });
      return instantiate
        .then(function (out) {
          global.__awkRawWasmInstance = out.instance || out;
          mode = 'raw';
          loaded = true;
          lastError = null;
          return true;
        })
        .catch(function (err) {
          lastError = err.message || String(err);
          return false;
        });
    });
  }

  function load() {
    if (loaded) return Promise.resolve(true);
    if (loading) return loading;
    if (!isSupported()) {
      lastError = 'WebAssembly is not supported in this browser';
      return Promise.resolve(false);
    }

    var base = wasmBaseUrl();
    loading = loadEmscripten(base)
      .then(function (ok) {
        if (ok) return true;
        return loadRawWasm(base);
      })
      .then(function (ok) {
        if (!ok && !lastError) {
          lastError =
            'AWK WASM files not found. Add assets/wasm/awk.js and awk.wasm (see assets/wasm/README.md).';
        }
        loading = null;
        return ok;
      })
      .catch(function (err) {
        lastError = err.message || String(err);
        loading = null;
        return false;
      });

    return loading;
  }

  function resetCapture(Module) {
    if (Module.capture) {
      Module.capture.out = '';
      Module.capture.err = '';
    }
  }

  function readCapture(Module) {
    var out = '';
    var err = '';
    if (Module.capture) {
      out = Module.capture.out;
      err = Module.capture.err;
    }
    return { stdout: out, stderr: err };
  }

  /**
   * Run AWK via Emscripten FS + callMain.
   * Expects build to expose awk as main with -f /script.awk /input.log
   */
  function runEmscripten(script, inputText) {
    var Module = global.Module;
    if (!Module || !Module.FS) {
      return failResult('Emscripten module missing FS API. Rebuild with FORCE_FILESYSTEM=1.', 1);
    }

    resetCapture(Module);
    Module.print = function (text) {
      Module.capture.out += text + '\n';
    };
    Module.printErr = function (text) {
      Module.capture.err += text + '\n';
    };

    try {
      try {
        Module.FS.unlink(INPUT_LOG);
      } catch (e) {}
      try {
        Module.FS.unlink(SCRIPT_AWK);
      } catch (e) {}

      Module.FS.writeFile(INPUT_LOG, inputText || '');
      Module.FS.writeFile(SCRIPT_AWK, script || '');

      var args = ['-f', SCRIPT_AWK, INPUT_LOG];
      var exitCode = 0;

      if (typeof Module.awkRunScript === 'function') {
        exitCode = Module.awkRunScript(SCRIPT_AWK, INPUT_LOG) | 0;
      } else if (typeof Module.callMain === 'function') {
        try {
          exitCode = Module.callMain(['awk'].concat(args)) | 0;
        } catch (e) {
          exitCode = Module.callMain(args) | 0;
        }
      } else if (typeof Module._main === 'function') {
        return failResult(
          'awk.wasm loaded but Module.callMain is missing. Export callMain in your Emscripten build.',
          1
        );
      } else {
        return failResult(
          'Emscripten AWK module has no callMain or awkRunScript hook. See assets/wasm/README.md.',
          1
        );
      }

      var cap = readCapture(Module);
      return okResult(cap.stdout, cap.stderr, exitCode);
    } catch (err) {
      var cap2 = readCapture(Module);
      return {
        ok: false,
        stdout: cap2.stdout,
        stderr: (cap2.stderr + '\n' + (err.message || err)).trim(),
        exitCode: 1,
      };
    }
  }

  function runRawWasm() {
    return failResult(
      'Raw awk.wasm loaded, but no stdin/stdout bridge is implemented yet. Use Emscripten build output for full AWK support.',
      1
    );
  }

  function run(script, inputText) {
    return load().then(function (ok) {
      if (!ok) return failResult(lastError, 1);
      if (mode === 'emscripten') return runEmscripten(script, inputText);
      if (mode === 'raw') return runRawWasm();
      return failResult(lastError || 'Unknown WASM load state', 1);
    });
  }

  var api = {
    isSupported: isSupported,
    isLoaded: isLoaded,
    getLastError: getLastError,
    getMode: getMode,
    load: load,
    run: run,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.AwkWasm = api;
})(typeof self !== 'undefined' ? self : window);
