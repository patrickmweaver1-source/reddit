#!/usr/bin/env bash
# TRAP Discipline launcher for macOS / Linux. Usage: ./start-trap.sh [--demo]
set -e
cd "$(dirname "$0")"
PY=python3
command -v $PY >/dev/null || { echo "Python 3.10+ is required (python.org/downloads)."; exit 1; }
if [ ! -x .venv/bin/python ]; then
  echo "First run: setting things up..."
  $PY -m venv .venv
fi
. .venv/bin/activate
python -m pip install --quiet --disable-pip-version-check -r requirements.txt
exec python -m server "$@"
