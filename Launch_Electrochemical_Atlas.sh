#!/bin/sh
cd "$(dirname "$0")" || exit 1
case "$(uname -m)" in
  x86_64|amd64) BIN="runtime/atlas-linux-amd64" ;;
  aarch64|arm64) BIN="runtime/atlas-linux-arm64" ;;
  *) echo "Unsupported Linux architecture"; exit 1 ;;
esac
if [ ! -f "$BIN" ]; then
  printf 'Electrochemical Atlas launcher is missing: %s\n' "$BIN" >&2
  exit 1
fi
chmod u+x "$BIN" 2>/dev/null
"./$BIN" "$@"
