---
name: decision-ops
description: "Captures, analyzes, and retrieves project rationale when a prompt implies a meaningful product, technical, or business tradeoff, performing full decision analysis inside the coding agent and showing the complete logged decision description in the response. Triggers on prompts like 'should we...', 'which option...', 'choose between...', 'prioritize...', 'what should we cut', 'descope', 'migrate to...', 'how should we release this', 'staged rollout', 'change pricing/onboarding/KPIs', 'improve reliability/performance/security', 'change vendors', 'select a partner', 'allocate budget', 'change revenue model', 'enter new market', 'change go-to-market', or 'compliance requirement'. Skips typo fixes, doc spelling, pure reformatting, and version bumps with no architectural choice."
license: Apache-2.0
compatibility: "Requires repository-local files and network access to the Decision Ops MCP service at https://api.aidecisionops.com/mcp. MCP authentication requires interactive browser OAuth (authorization code + PKCE) — there is no API key or token-based alternative for IDE users. The MCP server must be manually enabled in the IDE settings before first use."
metadata:
  maturity: "stable"
---

# Decision Ops

This skill teaches AI coding agents when and how to analyze and log decisions. The canonical decision store is the DecisionOps MCP service — not a local markdown file.

**Core Principle — In-Agent Decision Analysis & Complete Logged Output**:
1. **Full Decision Analysis Inside the Coding Agent**: The coding agent itself must perform the complete, structured decision analysis (evaluating Context & Problem Statement, Alternatives/Options with Pros & Cons, Chosen Decision & Rationale, Consequences/Risks/Tradeoffs, and Constraints/Rollout/Verification Plan) and pass that rich, complete structured content into `do-create-decision-draft` (and `do-validate-decision` / `do-publish-decision`). Never pass stubbed, skeletal, or one-line placeholder fields to the MCP tools.
2. **Complete Description Shown in the Agent Response**: Whenever the coding agent drafts, logs, updates, publishes, or discovers a decision, it **MUST NOT** log silently or merely mention the decision ID at the end of its reply. It **MUST** render the complete structured description of what was logged directly in its response to the user so the user knows the exact analysis and record persisted in DecisionOps.

## Local Manifest Binding

For IDE-driven usage, prefer a repository-local manifest at `.decisionops/manifest.toml`.

- Read it first when present by running `scripts/read-manifest.sh <repo-path>` from the installed skill directory.
- Required fields:
  - `org_id`
  - `project_id`
  - `repo_ref`
- Recommended fields:
  - `default_branch`
  - `mcp_server_name`
  - `mcp_server_url`
  - `repo_id` (optional local hint only; do not require it)
- Treat the manifest as local binding/config only. The MCP service remains the canonical system of record.
- If the manifest and central gate resolve to different org/project/repo values, stop and ask the user which context is correct before writing anything.

## Workflow

Use this workflow only when the task includes an explicit, non-trivial product, technical, or business tradeoff worth recording (or when the user asks to record, evaluate, or discover decisions).

1. Run the one-step gate with client hints.
- If `.decisionops/manifest.toml` exists, read it first and use `repo_ref` plus `default_branch` as the preferred local binding context.
- **Before calling the gate**, pre-classify the task yourself and ALWAYS include `client_hints` in the gate call. Because you have the full conversation context and your `client_hints` bypasses the backend LLM gate call (zero extra latency or backend token cost), compute:
  - `recordable`:
    - Set `true` when the task changes **or evaluates** architecture, data/storage models, ML/extraction pipelines, APIs, dependencies, policy, product direction, pricing, tooling standards, vendor choices, or operational guardrails.
    - Set `true` for exploratory trade-off assessments, RFCs, option comparisons (`"should we..."`, `"which option..."`, `"assess X vs Y"`), and controlled experiment proposals — even when `changed_paths` is empty (`[]`) or the prompt does not immediately adopt a final architecture (these become **`Proposed` · Needs Approval** decisions).
    - Set `false` only for routine bug fixes, typo fixes, pure formatting, mechanical refactors with no design tradeoff, or diagnostic health/doctor checks.
  - `classification_reason`: A concrete, one-sentence explanation (under 25 words) of why this is or isn't recordable.
  - `risk_level`: `"low"` | `"medium"` | `"high"` — based on blast radius, reversibility, and stakeholder impact.
  - `suggested_mode`: `"quick"` for low/medium-risk single-domain decisions or bounded experiments, `"comprehensive"` for high-risk, security/compliance, data-model, or cross-domain tradeoffs.
  - `signal_types`: Which domains this touches — `["technical"]`, `["product", "business"]`, etc.
- Call `decision-ops:do-prepare-decision-gate` with `client_hints` included (where `decision-ops` is the MCP server name from the manifest's `mcp_server_name`, defaulting to `decision-ops`). When `client_hints` is supplied, the backend uses your classification directly without calling an external LLM. Example:
  ```json
  {
    "repo_ref": "owner/repo",
    "task_summary": "Which ORM should we use — Drizzle vs Prisma vs Kysely",
    "client_hints": {
      "recordable": true,
      "classification_reason": "Choosing a project ORM is a durable technical dependency decision.",
      "risk_level": "medium",
      "suggested_mode": "quick",
      "signal_types": ["technical"]
    }
  }
  ```
- If central repository resolution fails but the manifest contains `org_id` and `project_id`, continue in manifest-bound mode and say so explicitly.
- **Project selection & on-demand creation (ONLY when unmapped; MUST be clickable options)**:
  - **Only ask about project creation when `project_resolution` is `"fallback_default"`** (meaning no dedicated project is mapped yet). When `project_resolution` is `"mapped_repo"`, `"explicit_project"`, or `"created_project"`, **do NOT ask to create a project** — only ask the mode choice (`Quick | Comprehensive | Skip`).
  - Whenever `do-prepare-decision-gate` returns a resolved `project_id` with `project_resolution: "mapped_repo"` or `"created_project"`, if `.decisionops/manifest.toml` is missing or its `project_id` differs (e.g. still `:default`), **automatically write/update `.decisionops/manifest.toml`** with the resolved `org_id`, `project_id`, and `repo_ref`.
  - When `do-prepare-decision-gate` returns `project_resolution: "fallback_default"` and `suggested_new_project`, **never relegate creating the new project to free-text instructions**. Make creating the new project a first-class clickable choice in your question UI (`request_user_input` / `AskUserQuestion` / `ask_question`):
    - **If the question tool supports multiple questions in `questions[]`**: pass **2 questions** in the same dialog:
      1. **Question 1 (Decision Logging Mode)**: `<Suggested Mode> (Recommended)`, `<Alternate Mode>`, `Skip decision logging`.
      2. **Question 2 (Target Project)**: `Create new project: <suggested_new_project.name> (Recommended)`, `Default Project (<org_id>:default)`, plus any other non-default projects from `available_projects`.
    - **If using a single-question card**: include explicit clickable options for creating the new project directly in the button list (for example: `1. <Suggested Mode> — Create <suggested_new_project.name> project (Recommended)`, `2. <Suggested Mode> — Default Project`, `3. <Alternate Mode> — Create <suggested_new_project.name> project`, `4. Skip decision logging`).
  - When the user selects **Create `<suggested_new_project.name>` project**, re-run `do-prepare-decision-gate` (or call `do-create-decision-draft`) with `create_project_if_missing: true` (boolean `true`) and `project_name: "<suggested_new_project.name>"`, then write/update `.decisionops/manifest.toml` with the returned `org_id`, `project_id`, and `repo_ref`.
  - If the user asks to create a new project directly, pass `create_project_if_missing: true` (and optional `project_name`) to `do-prepare-decision-gate` or `do-create-decision-draft`.
- **Always** show one user prompt with resolved `org/project/repo/branch`, the classification reason, clickable project target options (when unmapped), and the mode choices `Quick`, `Comprehensive`, `Skip`, or `Other`.
- If the gate returns `recordable: false`, still present the choices to the user. The gate is a heuristic hint, not a final decision. If the user's prompt clearly involves choosing between alternatives (e.g., "Which ORM should I use?", "Drizzle vs Prisma"), treat that as a decision worth recording regardless of the gate classification. Tell the user the gate classified it as not recordable, but offer to proceed anyway.

2. Gather evidence for the selected mode.
- `Skip`: stop decision flow and continue implementation without a decision write.
- `Quick`: call `decision-ops:do-search-decisions` with `mode: "quick"` to fetch up to 3 relevant prior decisions.
- `Comprehensive`: call `decision-ops:do-search-decisions` with `mode: "comprehensive"` and `include_body: true` to fetch up to 5 relevant prior decisions, including supersede candidates and prior outcomes.
- `Other`: require brief custom instructions, then map them to explicit search and evaluation parameters (`mode: "custom"`).
- When asked to discover existing architectural/product decisions from repository code and history, call `decision-ops:do-discover-decisions` and synthesize the discovered candidates in-agent.

3. Perform full in-agent decision analysis before acting or logging.
- Conduct the complete decision analysis directly inside the coding agent using repository evidence, user constraints, and prior decisions from `do-search-decisions`:
  - **Context & Problem Statement**: Articulate the concrete trigger, architectural or product background, hard constraints (latency, security, compliance, budget, compatibility), and why this decision must be made now.
  - **Alternatives / Options Considered**: Evaluate at least 2 viable options (or provide a rigorous `single_option_justification` if only 1 option is viable). Compare user impact, execution risk, reversibility, operational cost, and hard constraints, stating explicit **Pros**, **Cons**, and why each option was accepted or rejected.
  - **Chosen Decision & Rationale**: Formulate the chosen or recommended path, why it outperforms the alternatives, and the specific implementation boundaries and guardrails.
  - **Consequences, Risks & Tradeoffs**: Identify concrete positive outcomes, new operational costs, migration/maintenance risks, and follow-up obligations.
  - **Constraints, Rollout & Verification Plan**: Define how the decision will be rolled out and verified with a measurable 4-part scorecard (`metric`, `baseline`, `target`, `by_date`).
- Choose and implement the preferred option (when the user has requested implementation).

4. Author and validate a structured draft.
- Default to `scope_level: project` for project-wide decisions. Use `scope_level: repo` only when the decision should be bound to one repository.
- Never include raw secrets, API keys, bearer tokens, or private credentials in any decision field — redact sensitive values before calling MCP tools.
- **Structure fields with the full in-agent analysis** (avoid vague one-liners or wall-of-text paragraphs):
  - `title`: Concise, outcome-oriented title (`< 90` chars) stating the decision or recommendation (e.g., `"Use Postgres JSONB with GIN indexing for entity extraction store"`).
  - `decision`: Lead with a 1-2 sentence executive summary of the chosen or recommended path and core rationale, followed by key architectural constraints or implementation boundaries.
  - `context`: State the problem trigger, concrete operational/product constraints, prior decision context, and why a decision is required now.
  - `options`: Provide at least 2 distinct items in `options[]`, each formatted as `"<Option Name>: <What it is> — Pros: <upside> | Cons: <tradeoff/reason chosen or rejected>"`.
  - `consequences`: Provide 2-5 concise strings in `consequences[]`, each stating a concrete positive outcome, operational cost, risk, or follow-up requirement.
  - `validation_plan`: Populate `metric`, `baseline`, `target`, and `by_date` (`YYYY-MM-DD`) so the dashboard renders a measurable 4-part validation scorecard.
- Create the draft with `decision-ops:do-create-decision-draft` (creates the record in `Proposed` / **Needs Approval** state).
- Run `decision-ops:do-validate-decision` and fix any validation errors before finishing.

5. Decide between `Proposed` (Needs Approval) vs `Accepted` (Decision Taken).
- **Keep as `Proposed` (Needs Approval — do NOT call `do-publish-decision` yet)** when:
  - The user asked an open or exploratory question (`"should we..."`, `"which option..."`, `"assess..."`, `"compare..."`) and has not yet confirmed which option to adopt, OR
  - You are recording a provisional recommendation, RFC, or `high`-risk architectural proposal that requires human/team sign-off before implementation.
  - In this case, stop after `do-validate-decision` passes and present the complete logged decision summary with status **`Proposed (Needs Approval)`** (can be approved in the DecisionOps dashboard or published once the user confirms).
- **Publish as `Accepted` (Decision Taken — call `decision-ops:do-publish-decision`)** when:
  - The user has explicitly confirmed the choice or instructed you to implement/commit the decision now (e.g., `"let's use option A"`, `"implement this"`, `"lock this in"`).
  - Apply supersede updates atomically where declared, and present the complete logged decision summary with status **`Accepted (Decision Taken)`** for PR/commit traceability.

6. **Mandatory: Render the Complete Logged Decision Summary in Your Response**.
- **NEVER log silently or only mention `<decision_id>` in passing.** Whenever you call `do-create-decision-draft`, `do-publish-decision`, or `do-discover-decisions`, you **MUST** display the complete structured description of what was logged in your response to the user using the format below:

```markdown
### Decision Logged in DecisionOps

- **Decision ID**: `<decision_id>` · **Status**: `Proposed (Needs Approval)` | `Accepted (Decision Taken)` (v`<version>`)
- **Project**: `<project_name_or_id>` (`<org_id>`) · **Scope**: `<scope_level>` (`<repo_ref_if_applicable>`)
- **Title**: <title>
- **Domain / Impact**: `<type>` · `<risk_level>` risk
- **Dashboard Link**: `https://app.aidecisionops.com/decisions?id=<decision_id>`

#### Context & Problem Statement
<Complete context, problem statement, and operational/product constraints that were logged>

#### Chosen Decision & Rationale
<Complete chosen decision statement, rationale, and architectural/implementation boundaries that were logged>

#### Alternatives Considered
- **<Option 1>**: <What it is> — **Pros**: <upside> | **Cons**: <tradeoff / why accepted or rejected>
- **<Option 2>**: <What it is> — **Pros**: <upside> | **Cons**: <tradeoff / why accepted or rejected>

#### Consequences, Risks & Tradeoffs
- <Consequence, operational cost, risk, or follow-up requirement 1>
- <Consequence, operational cost, risk, or follow-up requirement 2>

#### Constraints, Rollout & Verification Plan
- **Validation Metric**: <validation_plan.metric>
- **Baseline**: <validation_plan.baseline>
- **Target**: <validation_plan.target>
- **Target Date**: <validation_plan.by_date>
- **Supersedes / Related**: <supersedes and related IDs/paths, or `None`>
```

- When `do-discover-decisions` is used, render a summary table of all discovered decisions (`Planner ID / Decision ID`, `Title`, `Domain / Category`, `Confidence`, `Readiness`) followed by the complete structured breakdown above for each decision drafted or logged from the discovery run.

## Decision Triggers

Record a decision when at least one of these is true:
- Introduce, remove, or significantly upgrade a dependency, platform, or provider.
- Change API shape, integration contract, schema, storage model, or data retention behavior.
- Choose between non-trivial product directions (pricing, onboarding flow, rollout strategy, support model).
- Adopt, defer, or waive a security/compliance/reliability control.
- Set a non-obvious testing or release strategy with explicit risk tradeoffs.
- Select, change, or terminate a vendor, supplier, or strategic partner.
- Make a significant budget, headcount, or resource allocation decision.
- Commit to a legal, contractual, or regulatory obligation, or change go-to-market strategy, customer segmentation, or revenue model.

## Assumptions and Defaults

- Central service is the only canonical source.
- Local manifest is an optional binding layer for IDE/repository setup.
- One-step gate is shown for every recordable decision attempt.
- User chooses mode each time (`Quick|Comprehensive|Skip|Other`).
- `Other` requires custom instructions and then continues.
- Full decision analysis happens inside the coding agent before calling `do-create-decision-draft`.
- Every logged, published, or discovered decision is shown in full in the coding agent's response (never silent or ID-only).
- Decision flow is fail-closed when validation fails. Project resolution may fall back to the local manifest when present. If the MCP server is unreachable, explain the connection/auth issue clearly and still provide the full in-agent decision analysis in your response.
- PR/commit traceability must include `decision_id`.

## References

- Use the manifest contract in [references/decision-ops-manifest.md](references/decision-ops-manifest.md).
- Use the MCP lifecycle contract in [references/mcp-interface.md](references/mcp-interface.md).
- Use the markdown structure in [references/decision-register-format.md](references/decision-register-format.md).
- Use the evaluation assets in [evals/trigger-queries.json](evals/trigger-queries.json) and [evals/evals.json](evals/evals.json) when validating activation and outcome quality.
