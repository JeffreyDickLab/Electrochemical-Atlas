#!/bin/bash
cd "$(dirname "$0")" || exit 1
case "$(uname -m)" in
  arm64) BIN="runtime/atlas-darwin-arm64" ;;
  x86_64) BIN="runtime/atlas-darwin-amd64" ;;
  *) echo "Unsupported Mac architecture"; read -r; exit 1 ;;
esac
if [ ! -f "$BIN" ]; then
  printf 'Electrochemical Atlas launcher is missing: %s\n' "$BIN" >&2
  read -r _ || true
  exit 1
fi
chmod u+x "$BIN" 2>/dev/null
"./$BIN" "$@"
STATUS=$?
if [ "$STATUS" -ne 0 ]; then printf '\nLauncher exited with error %s\n' "$STATUS"; read -r; fi
