# AWK WebAssembly build

Real [One True Awk](https://github.com/onetrueawk/awk) compiled for the browser. Output files:

- `assets/wasm/awk.js` — Emscripten glue (`AwkModule` factory)
- `assets/wasm/awk.wasm` — WebAssembly binary

The app runs:

```bash
awk -f /script.awk /input.log
```

via the virtual filesystem (`/script.awk`, `/input.log`) and `Module.callMain`.

## Prerequisites

1. **Emscripten SDK** (provides `emcc`)
2. **bison** (parser generator for `awkgram.y`)
3. **git**, **make** or **cc** (host tools for `maketab`)

### Install Emscripten (macOS example)

```bash
cd tools
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
emcc --version
```

### Install bison

```bash
brew install bison   # macOS
# apt install bison  # Debian/Ubuntu
```

## Build

From the repository root:

```bash
chmod +x tools/build-awk-wasm.sh
./tools/build-awk-wasm.sh
```

The script will:

1. Clone One True Awk into `tools/vendor/onetrueawk` (first run only)
2. Run `bison` on `awkgram.y`
3. Build `proctab.c` with host `maketab`
4. Compile with `emcc` using browser/worker flags

Expected output size is roughly 80–200 KB for `awk.js` and `awk.wasm` (varies by platform).

## Emscripten flags used

| Flag | Purpose |
|------|---------|
| `FORCE_FILESYSTEM=1` | Virtual FS for `/input.log` and `/script.awk` |
| `EXPORTED_RUNTIME_METHODS=['FS','callMain']` | FS API and argv entry |
| `NO_EXIT_RUNTIME=1` | Reuse module across runs |
| `MODULARIZE=1` | `AwkModule()` factory for workers |
| `EXPORT_NAME='AwkModule'` | Global factory name in `awk.js` |
| `ENVIRONMENT=web,worker` | Browser + Web Worker |
| `ALLOW_MEMORY_GROWTH=1` | Large log files |

## Verify in the app

1. Serve the site over HTTP (not `file://`):

   ```bash
   python3 -m http.server 8765
   ```

2. Open Workspace → **AWK WASM Engine**
3. **Load sample log** → **Run AWK**

Status should show: `AWK WASM ready (emscripten)`.

## Limitations

- **Field numbers** in AWK scripts assume space-separated log lines. Combined Apache/Nginx logs with quoted request fields may need different `$n` values or preprocessing.
- **Memory**: Very large logs are limited by browser WASM heap; use smaller samples or split files.
- **AWK dialect**: One True Awk (POSIX-ish); not GNU awk extensions.
- Rebuild after changing Emscripten or AWK source versions.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `emcc not found` | Activate emsdk: `source tools/emsdk/emsdk_env.sh` |
| `bison: command not found` | Install bison |
| `AwkModule factory is missing` | Re-run build; ensure `MODULARIZE=1` |
| `callMain is missing` | Rebuild with `EXPORTED_RUNTIME_METHODS` including `callMain` |
| WASM loads but no output | Check script fields match log format; inspect STDERR panel |

## Regenerating without cloning again

```bash
rm -rf tools/vendor/onetrueawk
./tools/build-awk-wasm.sh
```
