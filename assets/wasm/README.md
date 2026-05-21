# AWK WebAssembly build

The web app can run real AWK in the browser when these files are present:

- `assets/wasm/awk.js` — Emscripten glue (recommended)
- `assets/wasm/awk.wasm` — WebAssembly binary

Without them, the app keeps using the **JavaScript parser** and shows a friendly message if you select **AWK WASM Engine**.

## Recommended: Emscripten build

Compile an AWK implementation (e.g. **One True Awk**, **mawk**, or **BusyBox awk**) with [Emscripten](https://emscripten.org/).

### Example outline (adjust for your AWK source tree)

```bash
# Install Emscripten SDK, then:
source /path/to/emsdk/emsdk_env.sh

# Example using busybox awk (illustrative — paths vary by project)
emcc awk.c -o awk.js \
  -s WASM=1 \
  -s MODULARIZE=0 \
  -s EXPORTED_RUNTIME_METHODS='["FS","callMain","ccall","cwrap"]' \
  -s FORCE_FILESYSTEM=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s NO_EXIT_RUNTIME=1 \
  -s ASSERTIONS=1 \
  --pre-js awk-pre.js
```

Copy output to this folder:

```text
assets/wasm/awk.js
assets/wasm/awk.wasm
```

### What the app expects

`assets/js/awk-wasm.js` configures a global `Module` before loading `awk.js`, then:

1. Writes `inputText` to `/input.log` in the Emscripten virtual FS  
2. Writes the user script to `/script.awk`  
3. Runs: `awk -f /script.awk /input.log` (via `Module.callMain` or equivalent)  
4. Captures stdout/stderr via `Module.print` / `Module.printErr`

Your glue may use different entry symbols; if `callMain` is unavailable, document custom hooks in a small `--pre-js` file that sets `Module.awkRunScript = function(scriptPath, logPath) { ... }`.

### Optional `awk-pre.js`

```javascript
// Runs before emscripten glue; app also sets Module.print / printErr
Module.noInitialRun = true;
```

## Raw `awk.wasm` only

If you only place `awk.wasm` (no `awk.js`), the loader will instantiate the module but **cannot** feed stdin/stdout unless you add a custom bridge. The app returns:

> Raw awk.wasm loaded, but no stdin/stdout bridge is implemented yet. Use Emscripten build output for full AWK support.

## Limitations

- Large logs are limited by browser WASM memory  
- Startup cost: first run loads WASM (cached afterward)  
- Not all POSIX AWK extensions may be available in the chosen port  
- Combined log lines with quoted fields may need `FPAT` / custom `FS` in AWK

## Verify

1. Serve the site over HTTP (`python3 -m http.server`)  
2. Open Workspace → Engine → **AWK WASM Engine**  
3. Load sample log → **Run AWK**  
4. Check STDOUT panel for script output
