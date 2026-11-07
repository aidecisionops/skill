#!/usr/bin/env bash
set -euo pipefail

# ────────────────────────────────────────────────────────────────
# Integration test shell for decision-ops-skill CLI
# Tests both IDE and repo install paths against real file system
# ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="bun run $PROJECT_ROOT/src/cli.ts"

PASS=0
FAIL=0
TOTAL=0

TMP_ROOT=""

# ── Helpers ──

setup() {
  TMP_ROOT="$(mktemp -d /tmp/decision-ops-test-XXXXXX)"
  export TEST_HOME="$TMP_ROOT/home"
  export TEST_REPO="$TMP_ROOT/repo"
  mkdir -p "$TEST_HOME" "$TEST_REPO"
}

teardown() {
  if [[ -n "$TMP_ROOT" && -d "$TMP_ROOT" ]]; then
    rm -rf "$TMP_ROOT"
  fi
}

trap teardown EXIT

assert_file_exists() {
  local file="$1"
  local label="${2:-$file}"
  TOTAL=$((TOTAL + 1))
  if [[ -f "$file" ]]; then
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label (file not found: $file)"
    FAIL=$((FAIL + 1))
  fi
}

assert_file_not_exists() {
  local file="$1"
  local label="${2:-$file should not exist}"
  TOTAL=$((TOTAL + 1))
  if [[ ! -f "$file" ]]; then
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label (file still exists: $file)"
    FAIL=$((FAIL + 1))
  fi
}

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  local label="${3:-$file contains '$pattern'}"
  TOTAL=$((TOTAL + 1))
  if grep -q "$pattern" "$file" 2>/dev/null; then
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label (pattern not found in $file)"
    FAIL=$((FAIL + 1))
  fi
}

assert_file_not_contains() {
  local file="$1"
  local pattern="$2"
  local label="${3:-$file does not contain '$pattern'}"
  TOTAL=$((TOTAL + 1))
  if ! grep -q "$pattern" "$file" 2>/dev/null; then
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label (pattern found in $file)"
    FAIL=$((FAIL + 1))
  fi
}

assert_exit_zero() {
  local label="$1"
  shift
  TOTAL=$((TOTAL + 1))
  if "$@" > /dev/null 2>&1; then
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label (non-zero exit)"
    FAIL=$((FAIL + 1))
  fi
}

assert_exit_nonzero() {
  local label="$1"
  shift
  TOTAL=$((TOTAL + 1))
  if ! "$@" > /dev/null 2>&1; then
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label (expected non-zero exit)"
    FAIL=$((FAIL + 1))
  fi
}

assert_json_key() {
  local file="$1"
  local jq_expr="$2"
  local expected="$3"
  local label="${4:-$file $jq_expr == $expected}"
  TOTAL=$((TOTAL + 1))

  if ! command -v jq &>/dev/null; then
    # Fallback: use bun to parse JSON
    local actual
    actual=$(bun -e "console.log(JSON.stringify(require('$file')$jq_expr))" 2>/dev/null || echo "")
    if [[ "$actual" == "\"$expected\"" || "$actual" == "$expected" ]]; then
      echo "  ✓ $label"
      PASS=$((PASS + 1))
    else
      echo "  ✗ $label (got: $actual)"
      FAIL=$((FAIL + 1))
    fi
    return
  fi

  local actual
  actual=$(jq -r "$jq_expr" "$file" 2>/dev/null || echo "")
  if [[ "$actual" == "$expected" ]]; then
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label (expected '$expected', got '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

# ────────────────────────────────────────────────────────────────
# Tests
# ────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════"
echo " decision-ops-skill CLI install tests"
echo "═══════════════════════════════════════════════════"

# ── 1. CLI basics ──

echo ""
echo "── 1. CLI basics ──"

assert_exit_zero "cli --help" $CLI --help
assert_exit_zero "cli platforms" $CLI platforms

output=$($CLI platforms 2>&1)
TOTAL=$((TOTAL + 1))
if echo "$output" | grep -q "claude-code"; then
  echo "  ✓ platforms lists claude-code"
  PASS=$((PASS + 1))
else
  echo "  ✗ platforms does not list claude-code"
  FAIL=$((FAIL + 1))
fi

assert_exit_zero "cli paths claude-code" $CLI paths claude-code

# ── 2. IDE install: Claude Code ──

echo ""
echo "── 2. IDE install: Claude Code ──"
setup

CLAUDE_SKILLS="$TEST_HOME/.claude/skills"
export CLAUDE_SKILLS_DIR="$CLAUDE_SKILLS"

$CLI install ide claude-code 2>&1

assert_file_exists "$CLAUDE_SKILLS/decision-ops/SKILL.md" \
  "SKILL.md installed to ~/.claude/skills/decision-ops/"

assert_file_exists "$CLAUDE_SKILLS/decision-ops/references/mcp-interface.md" \
  "references/mcp-interface.md installed"

assert_file_exists "$CLAUDE_SKILLS/decision-ops/references/decision-ops-manifest.md" \
  "references/decision-ops-manifest.md installed"

assert_file_exists "$CLAUDE_SKILLS/decision-ops/references/decision-register-format.md" \
  "references/decision-register-format.md installed"

assert_file_exists "$CLAUDE_SKILLS/decision-ops/scripts/read-manifest.sh" \
  "scripts/read-manifest.sh installed"

assert_file_contains "$CLAUDE_SKILLS/decision-ops/SKILL.md" "name: decision-ops" \
  "SKILL.md has correct name in frontmatter"

assert_file_contains "$CLAUDE_SKILLS/decision-ops/SKILL.md" "^---" \
  "SKILL.md starts with frontmatter delimiter"

assert_exit_zero "installed read-manifest.sh --help works" \
  bash "$CLAUDE_SKILLS/decision-ops/scripts/read-manifest.sh" --help

unset CLAUDE_SKILLS_DIR
teardown

# ── 3. IDE install: Cursor ──

echo ""
echo "── 3. IDE install: Cursor ──"
setup

CURSOR_SKILLS="$TEST_HOME/.cursor/skills"
export CURSOR_SKILLS_DIR="$CURSOR_SKILLS"

$CLI install ide cursor 2>&1

assert_file_exists "$CURSOR_SKILLS/decision-ops/SKILL.md" \
  "SKILL.md installed to ~/.cursor/skills/decision-ops/"

assert_file_exists "$CURSOR_SKILLS/decision-ops/references/mcp-interface.md" \
  "references installed for Cursor"

unset CURSOR_SKILLS_DIR
teardown

# ── 4. IDE install: Codex ──

echo ""
echo "── 4. IDE install: Codex ──"
setup

CODEX_DIR="$TEST_HOME/.codex"
export CODEX_HOME="$CODEX_DIR"

$CLI install ide codex 2>&1

assert_file_exists "$CODEX_DIR/skills/decision-ops/SKILL.md" \
  "SKILL.md installed to ~/.codex/skills/decision-ops/"

unset CODEX_HOME
teardown

# ── 4b. IDE install: Antigravity ──

echo ""
echo "── 4b. IDE install: Antigravity ──"
setup

ANTIGRAVITY_SKILLS="$TEST_HOME/.gemini/config/skills"
export ANTIGRAVITY_SKILLS_DIR="$ANTIGRAVITY_SKILLS"

$CLI install ide antigravity 2>&1

assert_file_exists "$ANTIGRAVITY_SKILLS/decision-ops/SKILL.md" \
  "SKILL.md installed to ~/.gemini/config/skills/decision-ops/"

assert_file_exists "$ANTIGRAVITY_SKILLS/decision-ops/references/mcp-interface.md" \
  "references installed for Antigravity"

unset ANTIGRAVITY_SKILLS_DIR
teardown

# ── 5. IDE install: VS Code should fail ──

echo ""
echo "── 5. IDE install: VS Code (should fail) ──"

assert_exit_nonzero "vscode IDE install rejected" $CLI install ide vscode

# ── 6. Repo install: Claude Code (.mcp.json) ──

echo ""
echo "── 6. Repo install: Claude Code (.mcp.json) ──"
setup

$CLI install repo claude-code \
  --repo-path "$TEST_REPO" \
  --server-name decision-ops-mcp \
  --server-url https://api.aidecisionops.com/mcp \
  --org-id org_test_123 \
  --project-id proj_test_456 \
  --repo-ref github.com/test/repo \
  2>&1

assert_file_exists "$TEST_REPO/.mcp.json" \
  ".mcp.json created in repo root"

assert_json_key "$TEST_REPO/.mcp.json" '.mcpServers."decision-ops-mcp".type' "http" \
  ".mcp.json has server type = http"

assert_json_key "$TEST_REPO/.mcp.json" '.mcpServers."decision-ops-mcp".url' "https://api.aidecisionops.com/mcp" \
  ".mcp.json has correct server URL"

assert_file_exists "$TEST_REPO/.decisionops/manifest.toml" \
  ".decisionops/manifest.toml created"

assert_file_contains "$TEST_REPO/.decisionops/manifest.toml" 'org_id = "org_test_123"' \
  "manifest has org_id"

assert_file_contains "$TEST_REPO/.decisionops/manifest.toml" 'project_id = "proj_test_456"' \
  "manifest has project_id"

teardown

# ── 7. Repo install: Cursor (.cursor/mcp.json) ──

echo ""
echo "── 7. Repo install: Cursor (.cursor/mcp.json) ──"
setup

$CLI install repo cursor \
  --repo-path "$TEST_REPO" \
  --org-id org_cur \
  --project-id proj_cur \
  --repo-ref github.com/cur/repo \
  2>&1

assert_file_exists "$TEST_REPO/.cursor/mcp.json" \
  ".cursor/mcp.json created"

assert_json_key "$TEST_REPO/.cursor/mcp.json" '.mcpServers."decision-ops-mcp".type' "http" \
  ".cursor/mcp.json has server entry"

assert_file_exists "$TEST_REPO/.decisionops/manifest.toml" \
  "Cursor repo install created .decisionops/manifest.toml"

teardown

# ── 7b. Repo install: Codex (config.toml + manifest) ──

echo ""
echo "── 7b. Repo install: Codex (config.toml + manifest) ──"
setup

export CODEX_HOME="$TEST_HOME/.codex"

$CLI install repo codex \
  --repo-path "$TEST_REPO" \
  --org-id org_codex \
  --project-id proj_codex \
  --repo-ref github.com/codex/repo \
  2>&1

assert_file_exists "$CODEX_HOME/config.toml" \
  "Codex config.toml created"

assert_file_contains "$CODEX_HOME/config.toml" '\[mcp_servers\.decision-ops-mcp\]' \
  "Codex config.toml has mcp_servers.decision-ops-mcp section"

assert_file_exists "$TEST_REPO/.decisionops/manifest.toml" \
  "Codex repo install created .decisionops/manifest.toml"

unset CODEX_HOME
teardown

# ── 7c. Repo install: Antigravity (mcpServers.json + manifest) ──

echo ""
echo "── 7c. Repo install: Antigravity (mcpServers.json + manifest) ──"
setup

export ANTIGRAVITY_MCP_CONFIG_PATH="$TEST_HOME/.antigravity/mcpServers.json"

$CLI install repo antigravity \
  --repo-path "$TEST_REPO" \
  --org-id org_agy \
  --project-id proj_agy \
  --repo-ref github.com/agy/repo \
  2>&1

assert_file_exists "$ANTIGRAVITY_MCP_CONFIG_PATH" \
  "Antigravity mcpServers.json created"

assert_json_key "$ANTIGRAVITY_MCP_CONFIG_PATH" '.mcpServers."decision-ops-mcp".type' "http" \
  "Antigravity mcpServers.json has server entry"

assert_file_exists "$TEST_REPO/.decisionops/manifest.toml" \
  "Antigravity repo install created .decisionops/manifest.toml"

unset ANTIGRAVITY_MCP_CONFIG_PATH
teardown

# ── 8. Repo install: VS Code (.vscode/mcp.json) ──

echo ""
echo "── 8. Repo install: VS Code (.vscode/mcp.json) ──"
setup

$CLI install repo vscode \
  --repo-path "$TEST_REPO" \
  --org-id org_vsc \
  --project-id proj_vsc \
  --repo-ref github.com/vsc/repo \
  2>&1

assert_file_exists "$TEST_REPO/.vscode/mcp.json" \
  ".vscode/mcp.json created"

# VS Code uses "servers" not "mcpServers"
assert_json_key "$TEST_REPO/.vscode/mcp.json" '.servers."decision-ops-mcp".type' "http" \
  ".vscode/mcp.json uses 'servers' root key"

assert_file_exists "$TEST_REPO/.decisionops/manifest.toml" \
  "VS Code repo install created .decisionops/manifest.toml"

teardown

# ── 9. Repo install: merge safety ──

echo ""
echo "── 9. MCP config merge safety ──"
setup

# Pre-populate .mcp.json with an existing server
mkdir -p "$TEST_REPO"
echo '{"mcpServers":{"existing-server":{"type":"stdio","command":"node"}}}' > "$TEST_REPO/.mcp.json"

$CLI install repo claude-code \
  --repo-path "$TEST_REPO" \
  2>&1

assert_json_key "$TEST_REPO/.mcp.json" '.mcpServers."existing-server".type' "stdio" \
  "existing server entry preserved"

assert_json_key "$TEST_REPO/.mcp.json" '.mcpServers."decision-ops-mcp".type' "http" \
  "new server entry added alongside existing"

teardown

# ── 10. Manifest readable by read-manifest.sh ──

echo ""
echo "── 10. Manifest ↔ read-manifest.sh roundtrip ──"
setup

$CLI install repo claude-code \
  --repo-path "$TEST_REPO" \
  --org-id org_round \
  --project-id proj_round \
  --repo-ref github.com/round/trip \
  2>&1

MANIFEST_SCRIPT="$PROJECT_ROOT/decision-ops/scripts/read-manifest.sh"
MANIFEST_JSON=$(bash "$MANIFEST_SCRIPT" "$TEST_REPO")

TOTAL=$((TOTAL + 1))
if echo "$MANIFEST_JSON" | grep -q '"org_id": "org_round"'; then
  echo "  ✓ read-manifest.sh parses installed manifest correctly"
  PASS=$((PASS + 1))
else
  echo "  ✗ read-manifest.sh parse failed"
  FAIL=$((FAIL + 1))
fi

teardown

# ── 11. Dry run ──

echo ""
echo "── 11. Dry run (no files written) ──"
setup

CLAUDE_SKILLS="$TEST_HOME/.claude/skills"
export CLAUDE_SKILLS_DIR="$CLAUDE_SKILLS"

$CLI install all claude-code \
  --repo-path "$TEST_REPO" \
  --org-id org_dry \
  --project-id proj_dry \
  --repo-ref ref \
  --dry-run \
  2>&1

assert_file_not_exists "$CLAUDE_SKILLS/decision-ops/SKILL.md" \
  "dry-run: no skill files written"

assert_file_not_exists "$TEST_REPO/.mcp.json" \
  "dry-run: no MCP config written"

assert_file_not_exists "$TEST_REPO/.decisionops/manifest.toml" \
  "dry-run: no manifest written"

unset CLAUDE_SKILLS_DIR
teardown

# ── 12. Full combined install (IDE + repo) ──

echo ""
echo "── 12. Combined install: IDE + Repo ──"
setup

CLAUDE_SKILLS="$TEST_HOME/.claude/skills"
export CLAUDE_SKILLS_DIR="$CLAUDE_SKILLS"

$CLI install all claude-code \
  --repo-path "$TEST_REPO" \
  --org-id org_full \
  --project-id proj_full \
  --repo-ref github.com/full/install \
  2>&1

assert_file_exists "$CLAUDE_SKILLS/decision-ops/SKILL.md" \
  "IDE: SKILL.md installed"

assert_file_exists "$TEST_REPO/.mcp.json" \
  "Repo: .mcp.json created"

assert_file_exists "$TEST_REPO/.decisionops/manifest.toml" \
  "Repo: manifest.toml created"

# End-to-end: installed script can read installed manifest
INSTALLED_SCRIPT="$CLAUDE_SKILLS/decision-ops/scripts/read-manifest.sh"
TOTAL=$((TOTAL + 1))
if RESULT=$(bash "$INSTALLED_SCRIPT" "$TEST_REPO" 2>&1) && echo "$RESULT" | grep -q '"org_id": "org_full"'; then
  echo "  ✓ installed script reads repo manifest (end-to-end)"
  PASS=$((PASS + 1))
else
  echo "  ✗ installed script cannot read repo manifest"
  FAIL=$((FAIL + 1))
fi

unset CLAUDE_SKILLS_DIR
teardown

# ── 13. Uninstall IDE ──

echo ""
echo "── 13. Uninstall IDE ──"
setup

CLAUDE_SKILLS="$TEST_HOME/.claude/skills"
export CLAUDE_SKILLS_DIR="$CLAUDE_SKILLS"

$CLI install ide claude-code 2>&1
assert_file_exists "$CLAUDE_SKILLS/decision-ops/SKILL.md" "pre-uninstall: skill exists"

$CLI uninstall ide claude-code 2>&1
assert_file_not_exists "$CLAUDE_SKILLS/decision-ops/SKILL.md" "post-uninstall: skill removed"

unset CLAUDE_SKILLS_DIR
teardown

# ── 14. Uninstall repo MCP entry ──

echo ""
echo "── 14. Uninstall repo MCP entry ──"
setup

$CLI install repo claude-code --repo-path "$TEST_REPO" 2>&1
assert_file_exists "$TEST_REPO/.mcp.json" "pre-uninstall: .mcp.json exists"

$CLI uninstall repo claude-code --repo-path "$TEST_REPO" 2>&1

# Server entry should be gone but file should remain
assert_file_exists "$TEST_REPO/.mcp.json" "post-uninstall: .mcp.json still exists"
assert_file_not_contains "$TEST_REPO/.mcp.json" "decision-ops-mcp" \
  "post-uninstall: server entry removed"

teardown

# ── Summary ──

echo ""
echo "═══════════════════════════════════════════════════"
echo " Results: $PASS/$TOTAL passed, $FAIL failed"
echo "═══════════════════════════════════════════════════"
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
