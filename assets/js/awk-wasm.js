/**
 * AWK WASM loader — runs in main thread or Web Worker.
 *
 * Build output (Emscripten, MODULARIZE=1):
 *   assets/wasm/awk.js   → global AwkModule(factory) => Promise<Module>
 *   assets/wasm/awk.wasm
 *
 * Run: awk -f /script.awk /input.log via Module.FS + Module.callMain
 *
 * Rebuild: tools/build-awk-wasm.sh (requires emcc + bison)
 */
(function (global) {
  'use strict';

  var loaded = false;
  var loading = null;
  var lastError = null;
  /** @type {'none'|'emscripten'|'raw'} */
  var mode = 'none';
  /** @type {object|null} */
  var emModule = null;

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

  function makeCapture() {
    return { out: '', err: '' };
  }

  function bindCapture(Module, capture) {
    Module.capture = capture;
    Module.print = function (text) {
      capture.out += text + '\n';
    };
    Module.printErr = function (text) {
      capture.err += text + '\n';
    };
  }

  function resetCapture(Module) {
    if (Module.capture) {
      Module.capture.out = '';
      Module.capture.err = '';
    }
  }

  function readCapture(Module) {
    var c = Module.capture || { out: '', err: '' };
    var stderr = c.err.replace(
      /\n?program exited \(with status:[^\n]*\n?/g,
      '\n'
    );
    return { stdout: c.out, stderr: stderr.trim() };
  }

  /**
   * Load Emscripten MODULARIZE build (AwkModule factory).
   */
  function loadEmscripten(baseUrl) {
    return fetchExists(baseUrl + 'awk.js').then(function (exists) {
      if (!exists) return false;

      return new Promise(function (resolve) {
        try {
          importScripts('../wasm/awk.js');
        } catch (e) {
          lastError = 'Failed to load awk.js: ' + (e.message || e);
          resolve(false);
          return;
        }

        var factory = global.AwkModule;
        if (typeof factory !== 'function') {
          lastError =
            'awk.js loaded but AwkModule factory is missing. Rebuild with MODULARIZE=1 and EXPORT_NAME=AwkModule.';
          resolve(false);
          return;
        }

        var capture = makeCapture();
        factory({
          thisProgram: 'awk',
          locateFile: function (path) {
            if (path.indexOf('http') === 0) return path;
            return baseUrl + path;
          },
          noInitialRun: true,
          print: function (text) {
            capture.out += text + '\n';
          },
          printErr: function (text) {
            capture.err += text + '\n';
          },
        })
          .then(function (Module) {
            emModule = Module;
            bindCapture(emModule, capture);
            mode = 'emscripten';
            loaded = true;
            lastError = null;
            resolve(true);
          })
          .catch(function (err) {
            lastError = err.message || String(err);
            resolve(false);
          });
      });
    });
  }

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
            'AWK WASM files not found. Run tools/build-awk-wasm.sh (see assets/wasm/README.md).';
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

  function runEmscripten(script, inputText) {
    var Module = emModule;
    if (!Module || !Module.FS) {
      return failResult('Emscripten module missing FS API. Rebuild with FORCE_FILESYSTEM=1.', 1);
    }

    resetCapture(Module);

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
        // callMain prepends argv[0] (thisProgram); do not add a second program name.
        exitCode = Module.callMain(args) | 0;
      } else {
        return failResult(
          'awk.wasm loaded but Module.callMain is missing. Rebuild with EXPORTED_RUNTIME_METHODS including callMain.',
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
