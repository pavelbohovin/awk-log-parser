# AWK Log Parser

**Live app:** [https://awk.developer-pro.com/](https://awk.developer-pro.com/)

Parse Apache and Nginx access logs in the browser. No backend, no uploads, no tracking — all processing runs locally via Web Workers.

## Features

- **JavaScript parser** — combined Apache/Nginx access log format, presets, summary stats, CSV export
- **AWK WASM engine** (optional) — run real AWK scripts when `assets/wasm/awk.js` and `awk.wasm` are deployed ([build guide](assets/wasm/README.md))
- **Hash routing** — Home, Workspace, Analytics, Docs
- **Sample log** — try the app without uploading a file
- **Dark terminal UI** — Stitch-inspired design, responsive layout

## Quick start (local)

```bash
cd awk-analyzer
python3 -m http.server 8765
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/)

> Static files only — use any HTTP server; opening `index.html` as `file://` may break Web Workers.

## Project structure

```
index.html
assets/css/styles.css
assets/js/app.js
assets/js/parser.worker.js
assets/js/presets.js
assets/js/awk-examples.js
assets/js/awk-wasm.js
assets/js/sample-log.js
assets/wasm/          # optional Emscripten awk.js + awk.wasm
sample-access.log
```

## Privacy

Log files are read with the File API and never sent to a server. AWK execution (when enabled) also runs entirely in the browser.

## License

See repository for license terms.
