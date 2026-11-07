#!/usr/bin/env bash
set -euo pipefail

REPO_PATH="${1:-$PWD}"
MANIFEST_PATH="${REPO_PATH%/}/.decisionops/manifest.toml"

usage() {
  cat <<'USAGE'
Usage: read-manifest.sh [repo-path]

Read .decisionops/manifest.toml from a repository root and emit normalized JSON.
Required keys:
  - org_id
  - project_id
  - repo_ref
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Manifest not found: $MANIFEST_PATH" >&2
  exit 1
fi

extract_toml_string() {
  local key="$1"
  local line
  line="$(sed -nE "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*\"([^\"]*)\"[[:space:]]*$/\\1/p" "$MANIFEST_PATH" | head -n 1)"
  printf '%s' "$line"
}

json_escape() {
  printf '%s' "$1" | sed \
    -e 's/\\/\\\\/g' \
    -e 's/"/\\"/g'
}

org_id="$(extract_toml_string org_id)"
project_id="$(extract_toml_string project_id)"
repo_ref="$(extract_toml_string repo_ref)"
repo_id="$(extract_toml_string repo_id)"
default_branch="$(extract_toml_string default_branch)"
mcp_server_name="$(extract_toml_string mcp_server_name)"
mcp_server_url="$(extract_toml_string mcp_server_url)"

if [[ -z "$org_id" || -z "$project_id" || -z "$repo_ref" ]]; then
  echo "Manifest is missing one or more required keys: org_id, project_id, repo_ref" >&2
  exit 1
fi

printf '{\n'
printf '  "manifest_path": "%s",\n' "$(json_escape "$MANIFEST_PATH")"
printf '  "org_id": "%s",\n' "$(json_escape "$org_id")"
printf '  "project_id": "%s",\n' "$(json_escape "$project_id")"
printf '  "repo_ref": "%s",\n' "$(json_escape "$repo_ref")"
printf '  "repo_id": "%s",\n' "$(json_escape "$repo_id")"
printf '  "default_branch": "%s",\n' "$(json_escape "$default_branch")"
printf '  "mcp_server_name": "%s",\n' "$(json_escape "$mcp_server_name")"
printf '  "mcp_server_url": "%s"\n' "$(json_escape "$mcp_server_url")"
printf '}\n'
