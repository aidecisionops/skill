# Repository manifest and project binding

`.decisionops/manifest.toml` binds one checkout to an organization, project, repository, and MCP server. It contains no login credentials. The central service stores decisions and repository assignments.

## Fields

Required: `org_id`, `project_id`, `repo_ref`. The CLI also writes `version = 1`, `default_branch`, `mcp_server_name`, and `mcp_server_url`. `repo_id` is an optional hint; project-scoped decisions do not require it.

```toml
version = 1
org_id = "your-real-organization-id"
project_id = "your-real-project-id"
repo_ref = "acme/payments"
default_branch = "main"
mcp_server_name = "decision-ops-mcp"
mcp_server_url = "https://api.aidecisionops.com/mcp"
```

Use actual IDs returned by the service or copied from AI Coding Agents. Names, slugs and IDs are not interchangeable.

## Resolve before writing

Read the manifest as TOML, inspect the repository remote, then call `do-prepare-decision-gate` with `repo_ref`, `project_id`, `branch`, task context, and `create_project_if_missing: false`.

| Gate result | Meaning | Agent action |
| --- | --- | --- |
| `mapped_repo` | The repository already belongs to a project in this organization. | Reuse it. A missing manifest or stale Default Project binding can be updated to this mapping. A different non-default manifest project needs confirmation. |
| `explicit_project` | The supplied project exists, but this does not prove a repository assignment. | Use it for project-scoped work. Do not claim the repository is centrally linked. |
| `fallback_default` | No dedicated repository mapping was resolved. | Offer the suggested new project, Default Project, or another existing project. Do not create anything until the user chooses. |
| `created_project` | The explicit creation request provisioned a project. | Persist the returned ID and verify repository resolution in a second gate call. |

When the user selects a new project, call the gate again with `create_project_if_missing: true`, the same `repo_ref`, and the chosen `project_name`. Do not use draft creation as a provisioning shortcut. A pre-existing project with the same key can be returned as `mapped_repo`; use the returned ID rather than assuming a new project was created.

Project creation and repository assignment require write authorization. If the grant is read-only, explain the missing permission and use the client's normal OAuth control; never bypass consent. Lookup, search, and manifest inspection do not need write access.

## Update safely

- Stop before writes for an organization or repository mismatch. Ask which context is intended.
- Distinguish an expected, user-approved project change from an unexplained non-default project mismatch.
- Preserve branch, server name and URL, optional valid repository hint, comments, and unrelated settings. Replace only the approved binding fields, using a TOML-aware edit or the agent's structured file edit.
- Keep the same binding when installing another coding agent for this repository. Installing into another agent does not create another organization or project.
- Run the gate again with creation disabled. A successfully linked repository resolves as `mapped_repo` to the same ID. Restarting the agent should read the saved binding and reuse that project.
- A malformed manifest, unavailable service, or auth error is a blocker for write operations, not permission to invent configuration.

See [Onboarding and Project Setup](onboarding-and-projects.md) for installation and client verification.
