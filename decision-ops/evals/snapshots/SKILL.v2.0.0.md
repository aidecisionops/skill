---
name: decision-ops
description: "Captures, analyzes, and retrieves project rationale when a prompt implies a meaningful product, technical, or business tradeoff, performing full decision analysis inside the coding agent and showing the complete logged decision description in the response. Triggers on prompts like 'should we...', 'which option...', 'choose between...', 'prioritize...', 'what should we cut', 'descope', 'migrate to...', 'how should we release this', 'staged rollout', 'change pricing/onboarding/KPIs', 'improve reliability/performance/security', 'change vendors', 'select a partner', 'allocate budget', 'change revenue model', 'enter new market', 'change go-to-market', or 'compliance requirement'. Skips typo fixes, doc spelling, pure reformatting, and version bumps with no architectural choice."
license: Apache-2.0
compatibility: "Requires repository-local files and network access to the Decision Ops MCP service at https://api.aidecisionops.com/mcp. MCP authentication requires interactive browser OAuth (authorization code + PKCE) — there is no API key or token-based alternative for IDE users. The MCP server must be manually enabled in the IDE settings before first use."
metadata:
  maturity: "stable"
  prompt_version: "2.0.0"
---

# Decision Ops

This skill teaches AI coding agents when and how to analyze and log decisions. The canonical decision store is the DecisionOps MCP service — not a local markdown file.

**Core Principle — In-Agent Decision Analysis & Complete Logged Output**:
1. **Full Decision Analysis Inside the Coding Agent**: The coding agent itself must perform the complete, structured decision analysis (evaluating Context & Problem Statement, Alternatives/Options with Pros & Cons across explicit engineering/product axes, Chosen Decision & Rationale, Consequences/Risks/Tradeoffs with Reversal Triggers, and Constraints/Rollout/Verification Plan) and pass that rich, complete structured content into `do-create-decision-draft` (and `do-validate-decision` / `do-publish-decision`). Never pass stubbed, skeletal, or one-line placeholder fields to the MCP tools.
2. **Differentiated Depth (`Quick` vs `Comprehensive`)**: Selecting `Comprehensive` does **not** merely increase `do-search-decisions` from 3 to 5 results — it activates deep multi-option reasoning, codebase inspection, isolated option/prompt evaluation in a temporary workspace alongside `.decisionops/manifest.toml`, 5-axis trade-off scoring, `planner_analysis` evidence capture, and an Option Comparison Matrix in the response.
3. **Complete Description Shown in the Agent Response**: Whenever the coding agent drafts, logs, updates, publishes, or discovers a decision, it **MUST NOT** log silently or merely mention the decision ID at the end of its reply. It **MUST** render the complete structured description of what was logged directly in its response to the user so the user knows the exact analysis and record persisted in DecisionOps.

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
- Call `decision-ops:do-prepare-decision-gate` with `client_hints` included (where `decision-ops` is the MCP server name from the manifest's `mcp_server_name`, defaulting to `decision-ops`). Example:
  ```json
  {
    "repo_ref": "owner/repo",
    "task_summary": "Which ORM should we use — Drizzle vs Prisma vs Kysely",
    "client_hints": {
      "recordable": true,
      "classification_reason": "Choosing a project ORM is a durable technical dependency decision.",
      "risk_level": "medium",
      "suggested_mode": "comprehensive",
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
- If the gate returns `recordable: false`, still present the choices to the user if the prompt involves choosing between alternatives.

2. Gather evidence for the selected mode.
- `Skip`: stop decision flow and continue implementation without a decision write.
- `Quick`:
  - Call `decision-ops:do-search-decisions` with `mode: "quick"` to fetch up to 3 relevant prior decisions.
  - Inspect the directly affected repository files/configs so `related[]` and `context` reference real code paths.
- `Comprehensive`:
  - Call `decision-ops:do-search-decisions` with `mode: "comprehensive"` and `include_body: true` to fetch up to 5 relevant prior decisions, including supersede candidates and prior outcomes.
  - **Inspect Codebase & Use a Temp Evaluation Workspace When Needed**:
    - Read the relevant source files, schemas, manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `rebar.config`), and configuration files in the repository to ground the analysis in actual codebase constraints rather than generic theory.
    - When candidate options or prompts can be tested, spiked, or scored individually (e.g., comparing prompt variants, extraction logic, query/index plans, serialization formats, or library spikes), use a **temporary workspace** (`$TMPDIR/decisionops-<slug>/` or `.decisionops/.tmp/<slug>/` alongside `.decisionops/manifest.toml`, removing temporary scratch files before finishing) to evaluate each option individually and feed the empirical results into the decision record.
- `Other`: require brief custom instructions, then map them to explicit search and evaluation parameters (`mode: "custom"`).
- When asked to discover existing architectural/product decisions from repository code and history, call `decision-ops:do-discover-decisions` and synthesize the discovered candidates in-agent.

3. Perform full in-agent decision analysis before acting or logging.
- Conduct the decision analysis directly inside the coding agent using repository evidence, user constraints, and prior decisions from `do-search-decisions`:
  - **Context & Problem Statement**: Articulate the concrete trigger, architectural or product background, exact repository files/modules involved, hard constraints (latency, throughput, security, compliance, budget, compatibility), and why this decision must be made now.
  - **Alternatives / Options Considered**:
    - In **`Quick` mode**: Evaluate at least **2 viable options** (or provide a rigorous `single_option_justification` if only 1 option is viable) with explicit **Pros**, **Cons**, and why each was accepted or rejected.
    - In **`Comprehensive` mode**: Evaluate at least **3 distinct options** (including Status Quo / Do Nothing or a hybrid alternative where relevant). Score and compare every option across **5 mandatory engineering/product axes**:
      1. *Architecture & Codebase Fit* (exact modules, interfaces, and dependencies affected)
      2. *Performance, Scale & Cost* (latency, throughput, token/infrastructure cost, resource footprint)
      3. *Operational & Maintenance Burden* (observability, debugging complexity, vendor/upgrade risk)
      4. *Failure Modes, Security & Compliance* (blast radius, edge cases, regulatory/contractual impact)
      5. *Migration Effort & Reversibility* (one-way vs. two-way door, cutover complexity, rollback cost)
  - **Chosen Decision, Boundaries & Reversal Trigger**:
    - State the chosen or recommended option, why it outperforms each alternative on the dominant constraints, the concrete architectural/implementation boundaries (including explicit **Non-Goals**), and the **Rollback / Reversal Trigger** (what specific metric breach or production observation would cause the team to reverse or supersede this decision).
  - **Consequences, Risks & Second-Order Tradeoffs**:
    - Identify concrete positive outcomes, new operational or migration costs, failure modes with mitigations, and follow-up obligations (at least 2 items in `Quick` mode; at least 4 items including explicit downsides and second-order impacts in `Comprehensive` mode).
  - **Constraints, Rollout & Verification Plan**:
    - Define phased rollout steps and a measurable 4-part validation scorecard (`metric`, `baseline`, `target`, `by_date`). When options were benchmarked in a temp workspace, populate `baseline` and `target` with the measured numbers.
- Choose and implement the preferred option (when the user has requested implementation).

4. Author and validate a structured draft.
- Default to `scope_level: project` for project-wide decisions. Use `scope_level: repo` only when the decision should be bound to one repository.
- Never include raw secrets, API keys, bearer tokens, or private credentials in any decision field — redact sensitive values before calling MCP tools.
- **Structure fields with the full in-agent analysis** (never submit skeletal one-liners):
  - `title`: Concise, outcome-oriented title (`< 90` chars) stating the decision or recommendation (e.g., `"Adopt Postgres JSONB with GIN indexing for entity extraction store"`).
  - `decision`: Lead with a clear executive decision statement and core rationale, followed by architectural/implementation boundaries, explicit non-goals, and the rollback/reversal trigger.
  - `context`: State the problem trigger, concrete repository file paths/modules, operational/product hard constraints, prior decision context, and why a decision is required now.
  - `options`: Provide at least 2 distinct items (`Quick`) or 3+ distinct items (`Comprehensive`) in `options[]`, each formatted as:
    `"<Option Name>: <What it is & how it works in this codebase> — Pros: <concrete upsides across fit/perf/ops> | Cons: <concrete tradeoffs, failure modes, migration cost, and why accepted or rejected>"`
  - `consequences`: Provide 2–5 (`Quick`) or 4–6 (`Comprehensive`) concrete strings in `consequences[]`, explicitly covering positive impact, operational/migration cost, failure modes & mitigations, and the reversal trigger.
  - `related`: List the concrete repository file paths, configs, benchmarks, or prior decision IDs inspected during analysis (never leave empty).
  - `validation_plan`: Populate quantifiable `metric`, `baseline`, `target`, and `by_date` (`YYYY-MM-DD`).
  - `planner_analysis` (recommended in `Quick`, **mandatory in `Comprehensive`**): Populate structured evidence from your codebase/temp-workspace analysis:
    - `evidence`: Array of `{ "kind": "file-content" | "config-value" | "dependency" | "documentation", "source": "<file_path_or_artifact>", "detail": "<concrete finding or measured benchmark result>" }`
    - `impact`: `{ "level": "low" | "medium" | "high", "scope": "<affected subsystem>", "description": "<blast radius and reversibility summary>" }`
    - `ambiguities`: Array of `{ "description": "<open uncertainty>", "possibleInterpretations": ["<path A>", "<path B>"] }`
    - `tags`: Domain/component tags (e.g. `["storage", "latency", "compliance"]`)
    - `discoveredBy`: `["agent-comprehensive-analysis"]` (or `["agent-quick-analysis"]`)
    - `confidence`: Number between `0` and `1` (e.g. `0.9`)
- Create the draft with `decision-ops:do-create-decision-draft` (creates the record in `Proposed` / **Needs Approval** state).
- Run `decision-ops:do-validate-decision` and fix any validation errors or warnings before finishing.

5. Decide between `Proposed` (Needs Approval) vs `Accepted` (Decision Taken).
- **Keep as `Proposed` (Needs Approval — do NOT call `do-publish-decision` yet)** when:
  - The user asked an open or exploratory question (`"should we..."`, `"which option..."`, `"assess..."`, `"compare..."`) and has not yet confirmed which option to adopt, OR
  - You are recording a provisional recommendation, RFC, or `high`-risk architectural proposal that requires human/team sign-off before implementation.
  - In this case, stop after `do-validate-decision` passes and present the complete logged decision summary with status **`Proposed (Needs Approval)`**.
- **Publish as `Accepted` (Decision Taken — call `decision-ops:do-publish-decision`)** when:
  - The user has explicitly confirmed the choice or instructed you to implement/commit the decision now (e.g., `"let's use option A"`, `"implement this"`, `"lock this in"`).
  - Apply supersede updates atomically where declared, and present the complete logged decision summary with status **`Accepted (Decision Taken)`** for PR/commit traceability.

6. **Mandatory: Render the Complete Logged Decision Summary in Your Response**.
- **NEVER log silently or only mention `<decision_id>` in passing.** Whenever you call `do-create-decision-draft`, `do-publish-decision`, or `do-discover-decisions`, you **MUST** display the complete structured description of what was logged in your response to the user using the format below (including the **Option Comparison Matrix** table when `Comprehensive` mode is used):

```markdown
### Decision Logged in DecisionOps

- **Decision ID**: `<decision_id>` · **Status**: `Proposed (Needs Approval)` | `Accepted (Decision Taken)` (v`<version>`)
- **Project**: `<project_name_or_id>` (`<org_id>`) · **Scope**: `<scope_level>` (`<repo_ref_if_applicable>`)
- **Title**: <title>
- **Mode / Impact**: `<Quick | Comprehensive>` · `<type>` · `<risk_level>` risk
- **Dashboard Link**: `https://app.aidecisionops.com/decisions?id=<decision_id>`

#### Context & Problem Statement
<Complete context, problem statement, inspected repository paths, and operational/product constraints that were logged>

#### Chosen Decision, Boundaries & Reversal Trigger
<Complete chosen decision statement, core rationale, architectural/implementation boundaries, non-goals, and explicit rollback/reversal trigger>

#### Option Comparison Matrix (Mandatory in Comprehensive Mode)
| Option | Codebase & Arch Fit | Perf, Scale & Cost | Ops & Failure Risk | Migration & Reversibility | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **<Option 1>** | <fit> | <perf/cost> | <ops/risk> | <reversibility> | **Chosen / Recommended** |
| **<Option 2>** | <fit> | <perf/cost> | <ops/risk> | <reversibility> | Rejected (<why>) |
| **<Option 3 (Status Quo / Alt)>** | <fit> | <perf/cost> | <ops/risk> | <reversibility> | Rejected (<why>) |

#### Alternatives Considered (Detailed Pros & Cons)
- **<Option 1>**: <What it is> — **Pros**: <upside> | **Cons**: <tradeoff / why accepted or rejected>
- **<Option 2>**: <What it is> — **Pros**: <upside> | **Cons**: <tradeoff / why accepted or rejected>
- **<Option 3>**: <What it is> — **Pros**: <upside> | **Cons**: <tradeoff / why accepted or rejected>

#### Consequences, Risks & Tradeoffs
- <Positive outcome / primary benefit>
- <Operational or migration cost>
- <Failure mode / security / compliance risk & mitigation>
- <Rollback / reversal trigger condition>

#### Constraints, Rollout & Verification Plan
- **Validation Metric**: <validation_plan.metric>
- **Baseline**: <validation_plan.baseline>
- **Target**: <validation_plan.target>
- **Target Date**: <validation_plan.by_date>
- **Evidence & Related Paths**: <related file paths, benchmark artifacts, and superseded decision IDs>
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
- Local manifest is an optional binding layer for IDE/repository setup; temporary option/prompt evaluation spikes belong in `$TMPDIR` or `.decisionops/.tmp/` alongside the manifest and must not clutter the user's repository.
- One-step gate is shown for every recordable decision attempt.
- User chooses mode each time (`Quick|Comprehensive|Skip|Other`).
- `Comprehensive` mode enforces 5-axis evaluation across 3+ options, codebase evidence capture (`planner_analysis`), explicit reversal triggers, and an in-chat Option Comparison Matrix.
- Full decision analysis happens inside the coding agent before calling `do-create-decision-draft`.
- Every logged, published, or discovered decision is shown in full in the coding agent's response (never silent or ID-only).
- Decision flow is fail-closed when validation fails.
- PR/commit traceability must include `decision_id`.

## References

- Use the manifest contract in [references/decision-ops-manifest.md](references/decision-ops-manifest.md).
- Use the MCP lifecycle contract in [references/mcp-interface.md](references/mcp-interface.md).
- Use the markdown structure in [references/decision-register-format.md](references/decision-register-format.md).
- Use the evaluation assets in [evals/trigger-queries.json](evals/trigger-queries.json) and [evals/evals.json](evals/evals.json) when validating activation and outcome quality.
