# Onboarding and project setup

## Public distribution

Use the native [dops CLI](https://github.com/aidecisionops/cli) and [DecisionOps skill](https://github.com/aidecisionops/skill). Installation requires no npm package. Current web setup is at https://docs.aidecisionops.com/docs/ide-mcp/installing-mcp.

1. Sign in at https://app.aidecisionops.com. Email-link sign-in accepts plus-addresses; use the link received in that mailbox. Join the client's existing organization by invitation, or create the intended workspace and project.
2. Install dops from https://get.aidecisionops.com/dops (macOS/Linux) or https://get.aidecisionops.com/dops.ps1 (Windows), then run `dops login`.
3. In https://app.aidecisionops.com/integrations/agents choose the agent, organization and project. Run the generated `dops install <platform> ...` command inside the repository. Use the positional platform ID, not `--platform` or `--platforms`.
4. Inspect the skill, MCP configuration and repository manifest separately. The CLI and every coding client have independent OAuth sessions.
5. Enable or approve the MCP connection in that client, complete its browser consent, and verify a read-only search using the manifest's real organization/project. Inspect the client's skill list or invoke the skill explicitly to verify discovery.

After first login, **Connect your coding agent** opens this guided setup. Repository scanning is optional and can run alongside it. The default hosted scan checks repository coverage and provides starter suggestions; completion is not proof of recovered decisions. Users review and accept useful suggestions before they become decision records. For deeper discovery, inspect real code, architecture documents and history through the coding agent and present evidence-backed candidates for review.

Use this first prompt after setup:

> Read .decisionops/manifest.toml and the installed decision-ops skill. Use DecisionOps to search this organization and project for existing architecture decisions. Show the organization, project, and matching decision IDs. Do not create projects, draft decisions, or publish anything.

Honor this as a read-only task. Do not trigger project creation or draft a decision to populate an empty search. Confirm the binding used; a successful empty result is valid in a new project. Label sample records as examples.

During development, retrieve related decisions before changing an approach. For a meaningful tradeoff, compare options using repository evidence and prepare a proposal when requested. Let the user review and choose before accepting it; apply the main skill's validation and publishing rules. Routine spelling and formatting edits do not require records. Reuse the same manifest across later sessions and supported agents.

| Platform ID | Default personal skill directory | MCP configuration |
| --- | --- | --- |
| `codex` | `~/.agents/skills/decision-ops` | `~/.codex/config.toml` |
| `claude-code` | `~/.claude/skills/decision-ops` | repository `.mcp.json` |
| `cursor` | `~/.cursor/skills/decision-ops` | repository `.cursor/mcp.json` |
| `vscode` (Copilot harness) | `~/.copilot/skills/decision-ops` | repository `.vscode/mcp.json` |
| `antigravity` | `~/.gemini/config/skills/decision-ops` | `~/.gemini/config/mcp_config.json` |

The published `platforms/*.toml` catalog supplies installer destinations. Environment overrides can change those paths. VS Code sessions using another harness discover that harness's skill directories; use the matching platform target. Remote coding environments need installation on the machine running the agent. Local Cursor skills require explicit syncing for its Cloud Agents, or a repository skill for team/remote use.

For an existing MCP setup, `dops install <platform> --skip-mcp ...` adds the skill and binding without another server entry. Use `dops install <platform> --refresh` with dops 0.1.28+ to fetch current resources before reinstalling; review local customizations first. Without refresh, an earlier resource cache can be reused. For a stale skill, update dops if needed, reinstall from the current public skill catalog, and check the installed prompt version.

## Duplicate skills from other agents

Some clients import skills from other coding agents. Cursor can show an older `~/.claude/skills/decision-ops` instead of a same-named project skill. Open the skill from the client's list and inspect its actual path and `metadata.prompt_version`; finding the name alone is insufficient. Refresh the older installation using its own platform target, then reload the client and verify the selected source. Do not silently delete another agent's skill or disable all third-party imports. If the client still selects the older source, resolve that duplicate before recording client acceptance.

## First project and subsequent sessions

The manifest is configuration, not a decision store or a credential. Read [Repository Manifest](decision-ops-manifest.md) before resolving project context. Existing mappings are reused; an unmapped repository prompts for a project choice. Creation occurs only after the user chooses it, using the gate with write permission. Store the returned ID, preserve unrelated manifest settings, then call the gate with creation disabled to verify reuse.

A first search may return no decisions in a new project. That is valid only when authentication succeeds and the result uses the intended binding. Do not create a draft merely to make a search return something.

Read the binding with `dops manifest show --repo-path .` (dops 0.1.28+) on any supported operating system. The optional Unix helper uses Python 3.11+ when available, otherwise that native CLI command. Both reject malformed TOML and emit binding fields only.
