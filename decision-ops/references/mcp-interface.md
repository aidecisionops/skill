# Decision Ops MCP Interface

Use this reference only when you need the exact payload shape or error contract for the central MCP lifecycle.

## Authentication

All MCP tool calls require a valid OAuth access token (JWT). IDE MCP clients authenticate via interactive browser OAuth (authorization code + PKCE). There is no API key, token, or `client_credentials` method available for IDE users. Each IDE authenticates independently — CLI auth (`dops login`) does not carry over to IDE MCP sessions.

On first tool invocation, the IDE receives a `401` auth challenge with a `WWW-Authenticate` header pointing to the OAuth authorization server metadata. The user must complete sign-in and consent in the browser, then retry the tool call.

## Public APIs / Tools

`do-prepare-decision-gate`
- Authorization: ordinary resolution uses `mcp:read`; `create_project_if_missing: true` requires `mcp:write`. The tool can mutate when creation is requested.
- Purpose: combine project resolution and decision classification for one-step user prompting.
- Input:
  - `repo_ref` (path or URL; optional when `project_id` is provided)
  - `project_id` (optional when `repo_ref` is provided)
  - `branch` (optional)
  - `task_summary`
  - `changed_paths` (optional)
  - `create_project_if_missing` (bool or `"true"|"false"`, optional) — when `true`, automatically creates a dedicated project in the authenticated organization, links `repo_ref`, and returns `project_resolution = "created_project"`
  - `project_name` (string, optional) — display name for the newly created project when `create_project_if_missing=true`
  - `client_hints` (optional) — pre-classification from the AI agent:
    - `recordable` (bool) — agent's assessment of recordability
    - `classification_reason` (string) — agent's rationale
    - `risk_level` (`low|medium|high`) — agent's risk estimate
    - `suggested_mode` (`quick|comprehensive`) — agent's mode recommendation
    - `signal_types` (optional array of `technical|product|business|governance`) — detected decision domains
  - When `client_hints` is provided, the backend uses `client_hints` directly and skips the backend LLM gate call (zero extra latency or token cost). Merge order: `client_hints > backend_llm > heuristic`.
- Output:
  - `org_id`, `project_id`, `repo`, `branch`
  - `recordable` (bool)
  - `classification_reason`
  - `risk_level` (`low|medium|high`)
  - `suggested_mode` (`quick|comprehensive`)
  - `project_resolution` (`mapped_repo|explicit_project|fallback_default|created_project`)
  - `available_projects[]` (`id`, `project_key`, `name`, `is_default`)
  - `suggested_new_project` (`project_key`, `name`, `repo_ref` or `null`) — populated when `project_resolution="fallback_default"` so the agent can offer a clickable option to create a dedicated project for this repository and update `.decisionops/manifest.toml`

`do-search-decisions`
- Input:
  - `org_id`, `project_id`
  - `terms` (array)
  - `mode` (`quick|comprehensive|custom`)
  - `limit` (default `3` for quick, `5` for comprehensive)
  - `include_body` (default `false` for quick, `true` for comprehensive)
  - `custom` (object; optional, used when `mode=custom`)
- Output:
  - `items[]` with `id`, `title`, `status`, `date`, `score`, `snippet`, `superseded_by`, `related[]`, `body` (optional, present when `include_body=true`)
  - `candidate_supersedes[]`
  - `applied_parameters` (`mode`, `limit`, `include_body`, `custom`)

`do-create-decision-draft`
- Input:
  - `org_id`, `project_id`
  - `title`, `context`, `decision`
  - `type` (`technical|product|business|governance`, default `technical`)
  - `scope_level` (`org|project|repo`, default `project`)
  - `repo_id` (optional; used for `scope_level=repo`, especially in multi-repo projects)
  - `create_project_if_missing` (bool or `"true"|"false"`, optional) — creates the target project on demand if `project_id` does not yet exist
  - `project_name` (string, optional) — display name when auto-creating the project
  - `options`, `consequences`, `related` (arrays)
  - `supersedes` (array)
  - `single_option_justification` (string; required when only one option is supplied)
  - `validation_plan` (`metric`, `baseline`, `target`, `by_date`)
- Output:
  - `decision_id`, `version`, `status` (`Proposed`)
- Notes:
  - **In-agent decision analysis required**: The coding agent must perform the complete analysis of context, options/alternatives (with Pros & Cons), chosen decision & rationale, consequences/tradeoffs, and validation plan inside the agent before calling `do-create-decision-draft`.
  - Project-scoped drafts can be created even when the project has no linked repositories.
  - Only `scope_level=repo` requires linked repository resolution. Multi-repo projects must provide `repo_id` explicitly for repo-scoped drafts.
  - **Mandatory response summary**: After creating and validating a draft (or publishing it), the coding agent must output the full structured description of what was logged in its response to the user (Decision ID, Status, Project/Scope, Title, Domain/Impact, Context & Problem Statement, Chosen Decision & Rationale, Alternatives Considered, Consequences/Risks/Tradeoffs, Validation Plan, and Dashboard Link `https://app.aidecisionops.com/decisions?id=<decision_id>`).

`do-validate-decision`
- Input:
  - `org_id`, `project_id`
  - `decision_id` (string; optional when `draft` is provided)
  - `draft` (object; optional when `decision_id` is provided)
- Output:
  - `valid` (bool)
  - `errors[]` (`code`, `field`, `message`)
  - `warnings[]` (`code`, `field`, `message`)
- Notes:
  - When validating an inline `draft`, scope resolution is checked too.
  - Repo-scoped drafts can fail validation for missing or ambiguous repository linkage before creation.

`do-publish-decision`
- Input:
  - `org_id`, `project_id`, `decision_id`, `expected_version`
- Output:
  - `decision_id`, `status` (`Accepted`)
  - `supersede_updates[]` (`old_id`, `superseded_by`)
  - `published_at`
  - `version`
- Notes:
  - After publishing, the coding agent must render the complete logged decision summary in its response with status `Accepted (Decision Taken)` and the dashboard link `https://app.aidecisionops.com/decisions?id=<decision_id>`.

`do-get-decision`
- Read-only API.
- Input: `org_id`, `project_id`, `decision_id`
- Output: full `DecisionRecord`

`do-discover-decisions`
- Purpose: fast, zero-LLM repository discovery preflight and existing-decisions context check. Returns repository access/coverage metadata and any existing DecisionOps decisions or unaccepted suggestions so the coding agent can deduplicate and verify supersession locally.
- Deprecation Note (Hosted LLM Scanning): Invoking a hosted LLM repository scan from the coding agent skill is **deprecated**. Deep semantic repository analysis and temporal validity verification must run locally inside the user's coding agent following [references/repo-discovery-workflow.md](repo-discovery-workflow.md), and approved candidates must be submitted via `do-submit-discovery-candidates`.
- Input:
  - `org_id`, `project_id`, `repo_ref` (`owner/repo`)
  - `branch` (optional, default `main`)
  - `mode` (optional, `"preflight"` default — returns zero-LLM coverage facts and existing decisions/suggestions without triggering hosted LLM extraction)
- Output:
  - `org_id`, `project_id`, `repo_ref`, `branch`
  - `coverage` (`accessible`, `default_branch`, `head_commit`, `adr_files_found`, `open_prs_visible`, `unavailable_sources[]`)
  - `existing_decisions[]` (`decision_id`, `title`, `status`, `type`, `updated_at`)
  - `existing_suggestions[]` (`suggestion_id`, `stable_import_key`, `title`, `candidate_status`, `review_status`, `provenance`)
- Notes:
  - Never treat preflight coverage counts (e.g., `"3 ADR files found"`) as inferred decisions, and never rely on a hosted scan to generate decision claims for the agent.

`do-submit-discovery-candidates`
- Purpose: idempotently import user-reviewed, evidence-backed repository decision candidates discovered by the coding agent as **unverified discovery drafts** requiring explicit human acceptance in DecisionOps.
- Input (implements the **8-Field Draft Contract**):
  - `org_id`, `project_id`
  - **1. Repository & Revision**:
    - `repo_ref` (`owner/repo`)
    - `branch` (target branch inspected, e.g., `"main"`)
    - `base_commit` (commit SHA on `branch` against which candidates and `temporal_check` were verified)
    - `analyzed_at` (ISO-8601 timestamp of the agent analysis)
  - `candidates[]` (array of 1..50 user-approved discovery candidate drafts):
    - **2. Title & Decision Statement**:
      - `title` (`< 80` chars, plain English stating the chosen approach)
      - `decision_statement` (narrow, plain-English description of the chosen approach and scope; **strictly separate** from analyzer commentary)
      - `rationale` (`"Why this was inferred"` — plain-English explanation of why the evidence supports this candidate, kept separate from `decision_statement`)
      - `category` (domain/category slug, e.g., `"data-storage"`, `"authentication"`, `"api-contract"`, `"deployment"`)
      - `type` (`technical|product|business|governance`, default `technical`)
    - **3. Candidate Status (Temporal Validity)**:
      - `candidate_status` (`current|superseded|reverted|proposed|uncertain`) — reflects present validity in the repository and is distinct from DecisionOps review status (`pending_review`).
    - **4. Evidence**:
      - `evidence[]` (non-empty array of verifiable references):
        - `kind` (`adr|documentation|file-content|config-value|dependency|git-commit|pull-request`)
        - `source` (repository-relative file path, commit SHA, or PR reference)
        - `detail` (what this specific source supports)
        - `excerpt` (optional concise quote `<= 280` chars; never upload whole files or secrets)
        - `line_range` (optional, e.g., `"L14-L29"`)
        - `commit_sha` (optional commit SHA)
        - `pr_number` (optional pull request number)
        - `local_only` (bool, default `false` — set `true` when evidence comes from uncommitted local changes not verifiable on the remote repository)
    - **5. Temporal Check**:
      - `temporal_check` (required object proving present-validity verification):
        - `checked_against_ref` (branch/SHA checked, e.g., `"main@8f3d2a1"`)
        - `later_changes_examined` (summary of subsequent commits and current `HEAD` files inspected)
        - `reason` (plain-English explanation for `candidate_status`)
        - `superseded_by_ref` (optional commit SHA, PR, or `DEC-YYYY-NNNN` when `candidate_status="superseded"`)
        - `reverted_by_ref` (optional revert commit SHA when `candidate_status="reverted"`)
    - **6. Scope & Ambiguities**:
      - `scope` (`component`, `paths[]`, `missing_sources[]`)
      - `ambiguities[]` (`description`, `possible_interpretations[]` — required whenever options, metrics, or current state could not be verified from evidence; never fabricate options or deadlines)
    - **7. Provenance**:
      - `provenance` (`runner_type`: `"agent"`, `agent_name`, `skill_version`, `source_locality`: `"local"|"remote"|"mixed"`)
    - **8. Stable Import Key & Evidence-Backed Relationships**:
      - `stable_import_key` (deterministic key `<repo_ref>:<category>:<normalized-slug>` for idempotent retry and deduplication)
      - `relationships[]` (optional array of `{ target_key_or_decision_id, kind: "depends-on"|"supersedes"|"conflicts", evidence_detail }` — include only when backed by direct evidence; never run $O(N^2)$ pairwise LLM inference)
- Output:
  - `imported_count`, `updated_count`, `Deduplicated_count`
  - `candidates[]` (`suggestion_id`, `stable_import_key`, `title`, `candidate_status`, `review_status`: `"pending_review"`, `local_only_evidence`: bool)
  - `review_url` (`https://app.aidecisionops.com/decisions/discover?project=<project_id>`)
- Notes:
  - **Human review gate before calling**: The coding agent must present the discovered candidates table to the user and obtain explicit selection before calling `do-submit-discovery-candidates`.
  - **Never auto-published**: Imported candidates are stored as **unverified discovery drafts** (`review_status: "pending_review"`). They never silently become formal `Accepted` decisions without explicit human acceptance in DecisionOps.

## Public Types

`DecisionRecord`
- `id`, `decision_id`, `org_id`, `project_id`, `repo`, `branch`
- `title`, `status` (`Proposed|Accepted|Superseded`), `type` (`technical|product|business|governance`)
- `internal_status` (canonical DB status)
- `context`, `decision`
- `options[]`, `consequences[]`, `related[]`
- `supersedes[]`
- `validation_plan` (`metric`, `baseline`, `target`, `by_date`)
- `created_at`, `updated_at`, `version`

`DiscoveryCandidateDraft`
- `suggestion_id`, `stable_import_key`, `org_id`, `project_id`, `repo_ref`, `branch`, `base_commit`, `analyzed_at`
- `title`, `decision_statement`, `rationale`, `category`, `type`
- `candidate_status` (`current|superseded|reverted|proposed|uncertain`)
- `review_status` (`pending_review|accepted|rejected`)
- `evidence[]`, `temporal_check`, `scope`, `ambiguities[]`, `provenance`, `relationships[]`

## Error Contract

Error responses have the shape `{ error: { code, message, field, details } }`.

Possible error codes:
- `PROJECT_NOT_FOUND` (404)
- `NOT_FOUND` (404)
- `VALIDATION_FAILED` (422)
- `VERSION_CONFLICT` (409)

Note: `AUTH_REQUIRED` errors are handled at the middleware layer before reaching the decision-ops service.

## Evaluation Scenarios

Use these scenarios when reviewing output quality:

1. Non-recordable task returns `recordable=false`; selecting `Skip` performs no writes.
2. Recordable task with `Quick` fetches at most 3 summaries, performs full in-agent decision analysis, logs/publishes the decision, and displays the complete logged decision description in the agent response.
3. Recordable task with `Comprehensive` fetches full entries, identifies supersede candidates, publishes with atomic supersede updates, and displays the complete logged decision description in the agent response.
4. `Other` requires custom instructions; those instructions alter search and evaluation parameters for that run only.
5. Wrong project context is caught at gate display before draft creation.
6. Validation failure blocks publish until corrected.
7. Version conflict on publish requires retry with the latest version.
8. `do-get-decision` remains read-only and never creates records.
9. Logged or discovered decisions are never reported silently or as a bare `decision_id` — the agent response always shows the complete structured decision summary (ID, status, project, title, context, chosen decision & rationale, alternatives with pros/cons, consequences/tradeoffs, validation plan, and dashboard link).
10. Repository decision discovery performs multi-source local inspection and temporal validity checks (`current|superseded|reverted|proposed|uncertain`) inside the coding agent, presents the candidate review table to the user before calling `do-submit-discovery-candidates`, and imports approved items as unverified discovery drafts rather than relying on a hosted LLM scan or auto-publishing formal decisions.
11. Historical commits that were later reverted or replaced on `HEAD` are classified as `reverted` or `superseded` with a concrete `temporal_check.reason`, never misreported as `current`.
12. Weak evidence (`"this library or file exists"` with no non-trivial architectural or product choice) results in abstention or a plain observation rather than a fabricated decision candidate.
