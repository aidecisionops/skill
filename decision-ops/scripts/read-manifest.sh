#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo 'Usage: read-manifest.sh [repo-path]'
  echo 'Read a version 1 .decisionops/manifest.toml and emit binding fields as JSON.'
  exit 0
fi
REPO_PATH="${1:-$PWD}"
if command -v python3 >/dev/null && python3 -c 'import tomllib' 2>/dev/null; then
  exec python3 - "$REPO_PATH" <<'PYTHON'
import json,sys,tomllib
from pathlib import Path
p=Path(sys.argv[1]).resolve()/'.decisionops/manifest.toml'
try:
    d=tomllib.loads(p.read_text())
    if d.get('version',1)!=1:raise ValueError('unsupported manifest version')
    for key in ('org_id','project_id','repo_ref'):
        if not isinstance(d.get(key),str) or not d[key].strip():raise ValueError('missing or invalid '+key)
    print(json.dumps({'manifest_path':str(p),**{k:d.get(k,'') for k in ('org_id','project_id','repo_ref','repo_id','default_branch','mcp_server_name','mcp_server_url')}},indent=2))
except (OSError,UnicodeError,tomllib.TOMLDecodeError,ValueError) as e:
    print('Cannot read manifest: '+str(e),file=sys.stderr);sys.exit(1)
PYTHON
fi
if command -v dops >/dev/null; then
  exec dops manifest show --repo-path "$REPO_PATH"
fi
echo 'Read the manifest with agent file tools, or install dops 0.1.28+ (or Python 3.11+) to use this helper.' >&2
exit 1
