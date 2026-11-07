---
name: decision-ops
description: "Captures, analyzes, and retrieves project rationale when a prompt implies a meaningful product, technical, or business tradeoff, performing full decision analysis inside the coding agent and showing the complete logged decision description in the response. Triggers on prompts like 'should we...', 'which option...', 'choose between...', 'prioritize...', 'what should we cut', 'descope', 'migrate to...', 'how should we release this', 'staged rollout', 'change pricing/onboarding/KPIs', 'improve reliability/performance/security', 'change vendors', 'select a partner', 'allocate budget', 'change revenue model', 'enter new market', 'change go-to-market', or 'compliance requirement'. Skips typo fixes, doc spelling, pure reformatting, and version bumps with no architectural choice."
license: Apache-2.0
compatibility: "Requires repository-local files and network access to the Decision Ops MCP service at https://api.aidecisionops.com/mcp. MCP authentication requires interactive browser OAuth (authorization code + PKCE) — there is no API key or token-based alternative for IDE users. The MCP server must be manually enabled in the IDE settings before first use."
metadata:
  maturity: "stable"
  prompt_version: "2.1.0"
---

# Decision Ops

This skill teaches AI coding agents when and how to analyze and log decisions. The canonical decision store is the DecisionOps MCP service — not a local markdown file.

**Core Principles — Plain Language, Obvious Chosen Option & Complete Output**:
1. **Plain, Simple English (Zero Jargon)**: Write every decision title, option, rationale, and consequence in clear, everyday English that any teammate can scan in 10 seconds. Keep sentences short (under 25 words). Avoid stiff academic or editorial jargon (e.g., never write *"editorial spine"*, *"source-pinned"*, *"conflated"*, *"onward use"*, or dense 150-word paragraphs).
2. **Make the Chosen / Recommended Option Unmistakable**:
   - Always put the winning option **first (`options[0]`)** and prefix it with **`[CHOSEN]`** (when `Accepted`) or **`[RECOMMENDED]`** (when `Proposed`), and prefix rejected options with **`[NOT CHOSEN]`**.
   - Start the `decision` field with **`Chosen Option: Option 1 (<Short Name>).`** or **`Recommended Option: Option 1 (<Short Name>).`**
   - In your chat response, put a bold callout box at the very top naming the chosen/recommended option in one plain sentence, and mark the winning row in the comparison table with **`✅ CHOSEN`** or **`⭐ RECOMMENDED`** (and other rows with **`❌ Not chosen`**).
3. **Differentiated Depth (`Quick` vs `Comprehensive`)**: Selecting `Comprehensive` activates deep multi-option reasoning, codebase inspection, isolated option/prompt evaluation in a temporary workspace alongside `.decisionops/manifest.toml`, 5-axis trade-off scoring, `planner_analysis` evidence capture, and a proper Markdown Option Comparison Table in the response.
4. **Complete Description Shown in the Agent Response**: Whenever you draft, log, update, publish, or discover a decision, **NEVER** log silently or merely mention the decision ID at the end of your reply. Render the complete, plain-English structured decision summary directly in your response.

## Local Manifest Binding

For IDE-driven usage, prefer a repository-local manifest at `.decisionops/manifest.toml`.

- Read it first when present by running `scripts/read-manifest.sh <repo-path>` from the installed skill directory.
- Required fields: `org_id`, `project_id`, `repo_ref`.
- Recommended fields: `default_branch`, `mcp_server_name`, `mcp_server_url`, `repo_id` (optional local hint).
- Treat the manifest as local binding/config only. The MCP service remains the canonical system of record.
- If the manifest and central gate resolve to different org/project/repo values, stop and ask the user which context is correct before writing anything.

## Workflow

Use this workflow only when the task includes an explicit, non-trivial product, technical, or business tradeoff worth recording (or when the user asks to record, evaluate, or discover decisions).

1. Run the one-step gate with client hints.
- If `.decisionops/manifest.toml` exists, read it first and use `repo_ref` plus `default_branch` as the preferred local binding context.
- **Before calling the gate**, pre-classify the task yourself and ALWAYS include `client_hints` in the gate call:
  - `recordable`:
    - Set `true` when the task changes **or evaluates** architecture, data/storage models, ML/extraction pipelines, APIs, dependencies, policy, product direction, pricing, tooling standards, vendor choices, or operational guardrails.
    - Set `true` for exploratory trade-off assessments, RFCs, option comparisons (`"should we..."`, `"which option..."`, `"assess X vs Y"`), and controlled experiment proposals — even when `changed_paths` is empty (`[]`) or the prompt does not immediately adopt a final architecture (these become **`Proposed` · Needs Approval** decisions).
    - Set `false` only for routine bug fixes, typo fixes, pure formatting, mechanical refactors with no design tradeoff, or diagnostic health/doctor checks.
  - `classification_reason`: A plain, one-sentence explanation (under 25 words) of why this is or isn't recordable.
  - `risk_level`: `"low"` | `"medium"` | `"high"` — based on blast radius, reversibility, and stakeholder impact.
  - `suggested_mode`: `"quick"` for low/medium-risk single-domain decisions or bounded experiments, `"comprehensive"` for high-risk, security/compliance, data-model, or cross-domain tradeoffs.
  - `signal_types`: Which domains this touches — `["technical"]`, `["product", "business"]`, etc.
- Call `decision-ops:do-prepare-decision-gate` with `client_hints` included (where `decision-ops` is the MCP server name from the manifest's `mcp_server_name`, defaulting to `decision-ops`).
- If central repository resolution fails but the manifest contains `org_id` and `project_id`, continue in manifest-bound mode and say so explicitly.
- **Project selection & on-demand creation (ONLY when unmapped; MUST be clickable options)**:
  - **Only ask about project creation when `project_resolution` is `"fallback_default"`** (meaning no dedicated project is mapped yet). When `project_resolution` is `"mapped_repo"`, `"explicit_project"`, or `"created_project"`, **do NOT ask to create a project** — only ask the mode choice (`Quick | Comprehensive | Skip`).
  - Whenever `do-prepare-decision-gate` returns a resolved `project_id` with `project_resolution: "mapped_repo"` or `"created_project"`, if `.decisionops/manifest.toml` is missing or its `project_id` differs (e.g. still `:default`), **automatically write/update `.decisionops/manifest.toml`** with the resolved `org_id`, `project_id`, and `repo_ref`.
  - When `do-prepare-decision-gate` returns `project_resolution: "fallback_default"` and `suggested_new_project`, make creating the new project a first-class clickable choice in your question UI (`request_user_input` / `AskUserQuestion` / `ask_question`):
    - **If the question tool supports multiple questions in `questions[]`**: pass **2 questions** in the same dialog:
      1. **Question 1 (Decision Logging Mode)**: `<Suggested Mode> (Recommended)`, `<Alternate Mode>`, `Skip decision logging`.
      2. **Question 2 (Target Project)**: `Create new project: <suggested_new_project.name> (Recommended)`, `Default Project (<org_id>:default)`, plus any other non-default projects from `available_projects`.
    - **If using a single-question card**: include explicit clickable options for creating the new project directly in the button list (for example: `1. <Suggested Mode> — Create <suggested_new_project.name> project (Recommended)`, `2. <Suggested Mode> — Default Project`, `3. <Alternate Mode> — Create <suggested_new_project.name> project`, `4. Skip decision logging`).
  - When the user selects **Create `<suggested_new_project.name>` project**, re-run `do-prepare-decision-gate` (or call `do-create-decision-draft`) with `create_project_if_missing: true` and `project_name: "<suggested_new_project.name>"`, then write/update `.decisionops/manifest.toml`.
- **Always** show one user prompt with resolved `org/project/repo/branch`, the classification reason, clickable project target options (when unmapped), and the mode choices `Quick`, `Comprehensive`, `Skip`, or `Other`.

2. Gather evidence for the selected mode.
- `Skip`: stop decision flow and continue implementation without a decision write.
- `Quick`:
  - Call `decision-ops:do-search-decisions` with `mode: "quick"` to fetch up to 3 relevant prior decisions.
  - Inspect the directly affected repository files/configs so `related[]` and `context` reference real code paths.
- `Comprehensive`:
  - Call `decision-ops:do-search-decisions` with `mode: "comprehensive"` and `include_body: true` to fetch up to 5 relevant prior decisions, including supersede candidates and prior outcomes.
  - **Inspect Codebase & Use a Temp Evaluation Workspace When Needed**:
    - Read the relevant source files, schemas, manifests, and config files in the repository to ground the analysis in real repo constraints.
    - When candidate options or prompts can be tested, spiked, or scored individually, use a **temporary workspace** (`$TMPDIR/decisionops-<slug>/` or `.decisionops/.tmp/<slug>/` alongside `.decisionops/manifest.toml`, removing temporary scratch files before finishing) to evaluate each option individually and feed the measured results into the decision record.
- `Other`: require brief custom instructions, then map them to explicit search and evaluation parameters (`mode: "custom"`).
- When asked to discover existing architectural/product decisions from repository code and history, call `decision-ops:do-discover-decisions` and synthesize the discovered candidates in-agent.

3. Perform full in-agent decision analysis in plain, simple language.
- Conduct the decision analysis directly inside the coding agent using repository evidence, user constraints, and prior decisions:
  - **Why This Decision Is Needed (`context`)**: State in 2–4 short, plain sentences what problem triggered this, which repo files are involved, and what hard limits matter (speed, cost, safety, deadlines).
  - **Options Evaluated (`options[]`)**:
    - Always list the **Chosen / Recommended option first (`Option 1`)**, followed by the rejected alternatives (`Option 2`, `Option 3`).
    - In **`Quick` mode**: Compare at least **2 options** with plain-English **Pros**, **Cons**, and why Option 1 won.
    - In **`Comprehensive` mode**: Compare at least **3 distinct options** (including keeping the current setup or a simpler fallback). Evaluate every option across **5 clear criteria**:
      1. *Codebase Fit* (how well it works with existing files and schemas)
      2. *Speed, Scale & Cost* (latency, throughput, or effort required)
      3. *Maintenance & Operations* (how hard it is to run, update, and debug)
      4. *Failure & Safety Risks* (what can go wrong and how to prevent it)
      5. *Ease of Reversal* (how easily we can switch if it doesn't work)
  - **Chosen Option, Scope & When We'd Switch (`decision`)**:
    - Start with **`Chosen Option: Option 1 — <Short Name>.`** (or **`Recommended Option: Option 1 — <Short Name>.`** when `Proposed`).
    - In plain bullets or short sentences, state: (a) why Option 1 beat the other options, (b) what we are building/doing first, (c) what we are explicitly **not** doing right now, and (d) the **Switch / Rollback Trigger** (what specific result would make us change course).
  - **Tradeoffs & Risks (`consequences[]`)**:
    - Write 2–4 (`Quick`) or 4–5 (`Comprehensive`) short, plain-English points covering the main benefit, the main cost/effort, the main risk + fix, and when we would reverse the decision.
  - **How We'll Measure Success (`validation_plan`)**:
    - Define a concrete `metric`, `baseline`, `target`, and `by_date` (`YYYY-MM-DD`).

4. Author and validate a structured draft.
- Default to `scope_level: project` for project-wide decisions. Use `scope_level: repo` only when bound to one repository.
- Never include raw secrets, API keys, bearer tokens, or private credentials in any decision field.
- **Format fields clearly so the Chosen Option stands out in both the Dashboard and Chat**:
  - `title`: Plain, direct action title (`< 80` chars) stating the chosen direction (e.g., `"Write a single Physical AI overview guide linked to catalog profiles"` — avoid vague metaphors like `"editorial spine"`).
  - `decision`: Must begin with `"Chosen Option: Option 1 (<Name>). "` (if `Accepted`) or `"Recommended Option: Option 1 (<Name>). "` (if `Proposed`), followed by plain-English rationale, boundaries/non-goals, and the rollback/switch trigger.
  - `context`: Plain, concrete problem statement referencing actual repo files and constraints.
  - `options`: Provide 2+ (`Quick`) or 3+ (`Comprehensive`) items in `options[]`. **Always put the winning option at index `0` prefixed with `[CHOSEN]` or `[RECOMMENDED]`, and prefix rejected options with `[NOT CHOSEN]`**:
    - `options[0]`: `"[RECOMMENDED] Option 1 — <Short Name>: <Plain description> — Pros: <clear upsides> | Cons: <clear tradeoffs> | Why chosen: <1-sentence reason it beat the others>"` (use `[CHOSEN]` when publishing as `Accepted`).
    - `options[1..]`: `"[NOT CHOSEN] Option 2 — <Short Name>: <Plain description> — Pros: <clear upsides> | Cons: <clear tradeoffs> | Why not chosen: <1-sentence reason it lost>"`
  - `consequences`: 2–5 (`Quick`) or 4–6 (`Comprehensive`) short, plain-English strings covering benefits, costs/downsides, failure risks, and the rollback trigger.
  - `related`: Concrete repository file paths, configs, or prior decision IDs inspected (never empty).
  - `validation_plan`: Quantifiable `metric`, `baseline`, `target`, and `by_date` (`YYYY-MM-DD`).
  - `planner_analysis` (recommended in `Quick`, **mandatory in `Comprehensive`**): Populate `evidence[]` (`kind`, `source`, `detail`), `impact`, `ambiguities[]`, `tags[]`, `discoveredBy`, and `confidence`.
- Create the draft with `decision-ops:do-create-decision-draft` and validate it with `decision-ops:do-validate-decision`.

5. Decide between `Proposed` (Needs Approval) vs `Accepted` (Decision Taken).
- **Keep as `Proposed` (Needs Approval — do NOT call `do-publish-decision` yet)** when the user asked an open/exploratory question (`"should we..."`, `"which option..."`, `"assess..."`) and has not confirmed which option to adopt, OR for a provisional RFC / `high`-risk proposal awaiting sign-off. Prefix `options[0]` with `[RECOMMENDED]`.
- **Publish as `Accepted` (Decision Taken — call `decision-ops:do-publish-decision`)** when the user explicitly confirmed the choice or asked to implement it now. Prefix `options[0]` with `[CHOSEN]`.

6. **Mandatory: Render a Clear, Plain-English Decision Summary in Your Response**.
- **NEVER output unformatted tab-separated text or bury the chosen option in a paragraph.** Always use proper GitHub Markdown tables and put the **`✅ Chosen / Recommended Option`** callout box right at the top:

```markdown
### Decision Logged in DecisionOps

> **✅ Chosen / Recommended Option: Option 1 — <Option 1 Short Name>**
> **Why:** <1–2 plain-English sentences explaining what we are doing and why Option 1 beat Option 2 and Option 3.>

- **Decision ID**: `<decision_id>` · **Status**: `Proposed (Needs Approval)` | `Accepted (Decision Taken)` (v`<version>`)
- **Project**: `<project_name_or_id>` (`<org_id>`) · **Scope**: `<scope_level>` (`<repo_ref_if_applicable>`)
- **Title**: <Plain-English title>
- **Mode / Impact**: `<Quick | Comprehensive>` · `<type>` · `<risk_level>` risk
- **Dashboard Link**: [Open `<decision_id>` in DecisionOps](https://app.aidecisionops.com/decisions?id=<decision_id>)

#### Why This Decision Is Needed (Context)
<2–4 short, plain-English sentences stating the problem, the repo files involved, and the key constraints.>

#### What We're Doing & What We're Skipping (Decision & Boundaries)
- **What we're doing**: <Plain description of the chosen path and first step>
- **What we're skipping (Non-goals)**: <What we are explicitly not doing right now>
- **When we'd switch course (Rollback trigger)**: <Concrete signal or metric that would make us reverse this choice>

#### Option Comparison Matrix (Mandatory in Comprehensive Mode — Must Be a Markdown Table)
| Option | Codebase Fit | Speed, Scale & Cost | Maintenance & Risk | Ease of Reversal | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Option 1: <Name>** | <plain fit> | <plain speed/cost> | <plain risk> | <plain reversibility> | **✅ CHOSEN** *(or **⭐ RECOMMENDED**)* |
| **Option 2: <Name>** | <plain fit> | <plain speed/cost> | <plain risk> | <plain reversibility> | ❌ Not chosen (<short reason>) |
| **Option 3: <Name>** | <plain fit> | <plain speed/cost> | <plain risk> | <plain reversibility> | ❌ Not chosen (<short reason>) |

#### Options Considered (Pros, Cons & Why Chosen / Rejected)
- **✅ [CHOSEN / RECOMMENDED] Option 1 — <Name>**: <What it is>
  - **Pros**: <Plain upsides>
  - **Cons**: <Plain tradeoffs>
  - **Why chosen**: <Plain reason it won>
- **❌ [NOT CHOSEN] Option 2 — <Name>**: <What it is>
  - **Pros**: <Plain upsides>
  - **Cons**: <Plain tradeoffs>
  - **Why not chosen**: <Plain reason it lost>
- **❌ [NOT CHOSEN] Option 3 — <Name>**: <What it is>
  - **Pros**: <Plain upsides>
  - **Cons**: <Plain tradeoffs>
  - **Why not chosen**: <Plain reason it lost>

#### Tradeoffs & What Could Go Wrong (Consequences)
- **Benefit**: <Main positive outcome>
- **Cost / Effort**: <Main work or operational cost added>
- **Risk & Mitigation**: <What could go wrong and how we prevent it>
- **When to reverse**: <Condition that triggers switching to another option>

#### How We'll Measure Success (Validation Plan)
- **Metric**: <validation_plan.metric>
- **Current Baseline**: <validation_plan.baseline>
- **Target**: <validation_plan.target> by `<validation_plan.by_date>`
- **Files & Decisions Referenced**: <related file paths and decision IDs>
```

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
- Write in plain, simple English with zero bureaucratic jargon.
- Always make the chosen/recommended option visually unmistakable (`[CHOSEN]` / `[RECOMMENDED]` at `options[0]`, top callout box, and `✅ CHOSEN` / `⭐ RECOMMENDED` vs `❌ Not chosen` in the Markdown comparison table).
- Decision flow is fail-closed when validation fails.
- PR/commit traceability must include `decision_id`.

## References

- Use the manifest contract in [references/decision-ops-manifest.md](references/decision-ops-manifest.md).
- Use the MCP lifecycle contract in [references/mcp-interface.md](references/mcp-interface.md).
- Use the markdown structure in [references/decision-register-format.md](references/decision-register-format.md).
- Use the evaluation assets in [evals/trigger-queries.json](evals/trigger-queries.json) and [evals/evals.json](evals/evals.json) when validating activation and outcome quality.
