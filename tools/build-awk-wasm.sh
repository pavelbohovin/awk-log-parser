#!/usr/bin/env bash
# Build One True Awk (https://github.com/onetrueawk/awk) to WebAssembly via Emscripten.
# Output: assets/wasm/awk.js, assets/wasm/awk.wasm
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/tools/vendor/onetrueawk"
OUT="$ROOT/assets/wasm"
EMS_SDK="$ROOT/tools/emsdk"
AWK_REPO="${AWK_REPO:-https://github.com/onetrueawk/awk.git}"
AWK_REF="${AWK_REF:-master}"

die() { echo "error: $*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is required"
command -v bison >/dev/null 2>&1 || die "bison is required (brew install bison)"

if [[ -f "$EMS_SDK/emsdk_env.sh" ]]; then
  # shellcheck source=/dev/null
  source "$EMS_SDK/emsdk_env.sh"
fi

command -v emcc >/dev/null 2>&1 || die "emcc not found. Run: tools/emsdk/install latest && tools/emsdk/activate latest"

mkdir -p "$OUT" "$(dirname "$VENDOR")"

if [[ ! -d "$VENDOR/.git" ]]; then
  echo "==> Cloning One True Awk from $AWK_REPO"
  git clone --depth 1 --branch "$AWK_REF" "$AWK_REPO" "$VENDOR"
fi

cd "$VENDOR"

echo "==> Generating parser (bison)"
bison -d -o awkgram.tab.c awkgram.y

echo "==> Generating proctab.c (host maketab)"
"${CC:-cc}" -O2 -o maketab maketab.c
./maketab awkgram.tab.h > proctab.c

SRC=(
  awkgram.tab.c
  b.c
  main.c
  parse.c
  proctab.c
  tran.c
  lib.c
  run.c
  lex.c
)

echo "==> Compiling with emcc"
emcc "${SRC[@]}" \
  -O2 \
  -s WASM=1 \
  -s FORCE_FILESYSTEM=1 \
  -s EXPORTED_RUNTIME_METHODS='["FS","callMain"]' \
  -s NO_EXIT_RUNTIME=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='AwkModule' \
  -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s ASSERTIONS=1 \
  -s STACK_SIZE=8388608 \
  -lm \
  -o "$OUT/awk.js"

echo "==> Done"
ls -lh "$OUT/awk.js" "$OUT/awk.wasm"
echo "Load in browser: Engine → AWK WASM Engine → Run AWK"
