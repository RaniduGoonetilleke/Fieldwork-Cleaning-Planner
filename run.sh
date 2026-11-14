#!/usr/bin/env bash
set -euo pipefail
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd -- "$app_dir"
if [[ -n "${PYTHON_BIN:-}" ]]; then
  app_python="$PYTHON_BIN"
else
  app_python=""
  for candidate in python3.12 python3; do
    if "$candidate" -c 'import sys; raise SystemExit(sys.version_info[:2] != (3, 12))' >/dev/null 2>&1; then
      app_python="$candidate"
      break
    fi
  done
  if [[ -z "$app_python" ]]; then
    echo 'Python 3.12 was not found. Set PYTHON_BIN to its executable.' >&2
    exit 1
  fi
fi
"$app_python" -c 'import sys; assert sys.version_info[:2] == (3, 12), "Use Python 3.12, or set PYTHON_BIN to its executable."'
if [[ "${1:-}" == "--test" ]]; then
  exec "$app_python" -B -m unittest discover -s tests -p 'test_*.py' -v
elif [[ "${1:-}" == "--check" ]]; then
  exec "$app_python" -B -c 'import planner_service; from verify_release import verify; print("Release files checked:", verify()); print("Verified exact sources:", len(planner_service.verify_sources()["files"])); print("Offline service loaded; no robot connection.")'
else
  exec "$app_python" -B server.py "$@"
fi
