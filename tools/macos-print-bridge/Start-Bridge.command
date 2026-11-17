#!/bin/sh
set -eu
case "$(uname -s)" in
  Darwin) ;;
  *) echo "The FeedX macOS Print Bridge requires macOS." >&2; exit 1 ;;
esac
if ! command -v python3 >/dev/null 2>&1; then
  echo "Install Python 3.9 or newer and retry." >&2
  exit 1
fi
if [ "$#" -eq 0 ]; then
  set -- start
fi
exec python3 -B "$(dirname "$0")/bridge.py" "$@"
