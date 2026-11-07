# Decision Ops Manifest

Use `.decisionops/manifest.toml` in the target repository root to bind a local repository to central Decision Ops identifiers.

## Required fields

- `org_id`
- `project_id`
- `repo_ref`

## Recommended fields

- `default_branch`
- `mcp_server_name`
- `mcp_server_url`
- `repo_id` (optional local hint; current MCP workflow should not require it)

## Example

```toml
version = 1
org_id = "org_123"
project_id = "proj_456"
repo_ref = "acme/payments"
default_branch = "main"
mcp_server_name = "decision-ops-mcp"
mcp_server_url = "https://api.aidecisionops.com/mcp"
```

## Behavior

- The manifest is local configuration, not the canonical decision register.
- Agents should read the manifest before calling the central MCP lifecycle.
- If `do-prepare-decision-gate` returns `project_resolution = "mapped_repo"` or `"explicit_project"`, the repository already has a bound project and the agent proceeds without asking which project to use.
- If `do-prepare-decision-gate` returns `project_resolution = "fallback_default"`, no dedicated project is mapped to `repo_ref` yet. The agent offers the user a choice in the gate prompt to either create a new dedicated project (`create_project_if_missing: true`, `project_name`) or record under `Default Project`.
- When a new project is created (`project_resolution = "created_project"`), the agent updates `.decisionops/manifest.toml` with the new `org_id`, `project_id`, and `repo_ref` so subsequent sessions resolve directly via `mapped_repo`.
