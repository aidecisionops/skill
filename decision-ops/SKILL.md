---
name: decision-ops
description: "Captures, analyzes, discovers, and retrieves project decisions about product, technical, or business tradeoffs and architectural changes. Performs analysis in the coding agent and shows the complete logged decision. Triggers on prompts like 'should we...', 'which option...', 'choose between...', 'prioritize...', 'what should we cut', 'descope', 'migrate to...', 'how should we release this', 'staged rollout', 'change pricing/onboarding/KPIs', 'improve reliability/performance/security', 'address architectural gaps', 'fix query/performance bottlenecks', 'generalize architecture/policy', 'change vendors', 'select a partner', 'allocate budget', 'change revenue model', 'enter new market', 'change go-to-market', 'compliance requirement', or 'discover/audit existing decisions in this repo'. Skips typo fixes, doc spelling, pure reformatting, and version bumps with no architectural choice."
license: Apache-2.0
compatibility: "Requires repository-local files and network access to the Decision Ops MCP service at https://api.aidecisionops.com/mcp. MCP authentication requires interactive browser OAuth (authorization code + PKCE) — there is no API key or token-based alternative for IDE users. The MCP server must be manually enabled in the IDE settings before first use."
metadata:
  maturity: "stable"
  prompt_version: "2.4.1"
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

- Read it first as TOML. On Unix, `scripts/read-manifest.sh <repo-path>` reads CLI-generated manifests; on other systems use the agent's file tools. Stop on malformed or conflicting bindings rather than guessing IDs.
- Required fields: `org_id`, `project_id`, `repo_ref`.
- Recommended fields: `default_branch`, `mcp_server_name`, `mcp_server_url`, `repo_id` (optional local hint).
- Treat the manifest as local binding/config only. The MCP service remains the canonical system of record.
- Stop before writes if the authenticated organization or repository differs from the manifest. A returned project difference requires confirmation unless it is the result of the user-approved project creation or a stale Default Project binding resolved to the repository's existing mapped project. Follow [project binding rules](references/decision-ops-manifest.md) and preserve unrelated manifest settings when updating it.
- For installation, agent discovery, and the initial project-selection flow, read [Onboarding and Project Setup](references/onboarding-and-projects.md).

## Workflow

Use this workflow only when the task includes an explicit, non-trivial product, technical, or business tradeoff worth recording (or when the user asks to record, evaluate, or discover decisions).

0. **Follow-Up Acceptance Check (Prevent Duplicate Drafts & Update `Proposed` $\rightarrow$ `Accepted`)**:
- **Before running the gate (`do-prepare-decision-gate`)**, check whether a **`Proposed`** decision (`DEC-YYYY-NNNN`) was already drafted earlier in this conversation:
  - If a `Proposed` decision (`DEC-YYYY-NNNN`) already exists in the current conversation and the user's message confirms, refines, selects, or asks to implement an option (e.g., `"let's go ahead with Option 1"`, `"Option 1 with a stronger B"`, `"yes let's do that"`, `"implement Option 2"`, `"accept that decision"`), **do NOT call `do-prepare-decision-gate` or `do-create-decision-draft` again**.
  - Instead, immediately call `decision-ops:do-publish-decision` on that existing `decision_id` (passing `chosen_option_index: 0` for Option 1, `1` for Option 2, etc., and optional updated `decision` / `title` text to reflect the user's refinement) so the record transitions from **`Proposed` (`Needs Approval`)** to **`Accepted` (`Decision Taken`)** in place.
  - Only if new measurements or scope changes require replacing the earlier `Proposed` draft with a brand-new record, pass `supersedes: ["DEC-YYYY-NNNN"]` on `do-create-decision-draft` so publishing the new record automatically transitions the earlier `Proposed` draft to **`Superseded`**.

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
- Call `decision-ops:do-prepare-decision-gate` with `client_hints` included (where `decision-ops` is the MCP server name from the manifest's `mcp_server_name`, defaulting to `decision-ops-mcp`).
- First call the gate with `create_project_if_missing: false`. If central repository resolution fails, a valid manifest can support project-scoped lookup; state that repository mapping was not verified. Do not bypass authorization errors or silently create a project.
- **Project selection & on-demand creation (ONLY when unmapped; MUST be clickable options)**:
  - **Only ask about project creation when `project_resolution` is `"fallback_default"`** (meaning no dedicated project is mapped yet). When `project_resolution` is `"mapped_repo"`, `"explicit_project"`, or `"created_project"`, **do NOT ask to create a project** — only ask the mode choice (`Quick | Comprehensive | Skip`).
  - Whenever `do-prepare-decision-gate` returns a resolved `project_id` with `project_resolution: "mapped_repo"` or `"created_project"`, if `.decisionops/manifest.toml` is missing or its `project_id` differs (e.g. still `:default`), **update the binding only under the mismatch rules above**, using the returned `org_id`, `project_id`, and `repo`; retain `version`, branch, MCP server settings, and unrelated fields. A non-default existing project mismatch needs the user's choice.
  - When `do-prepare-decision-gate` returns `project_resolution: "fallback_default"` and `suggested_new_project`, make creating the new project a first-class clickable choice in your question UI (`request_user_input` / `AskUserQuestion` / `ask_question`):
    - **If the question tool supports multiple questions in `questions[]`**: pass **2 questions** in the same dialog:
      1. **Question 1 (Decision Logging Mode)**: `<Suggested Mode> (Recommended)`, `<Alternate Mode>`, `Skip decision logging`.
      2. **Question 2 (Target Project)**: `Create new project: <suggested_new_project.name> (Recommended)`, `Default Project (<org_id>:default)`, plus any other non-default projects from `available_projects`.
    - **If using a single-question card**: include explicit clickable options for creating the new project directly in the button list (for example: `1. <Suggested Mode> — Create <suggested_new_project.name> project (Recommended)`, `2. <Suggested Mode> — Default Project`, `3. <Alternate Mode> — Create <suggested_new_project.name> project`, `4. Skip decision logging`).
  - When the user selects **Create `<suggested_new_project.name>` project**, re-run `do-prepare-decision-gate` with `create_project_if_missing: true` and `project_name: "<suggested_new_project.name>"`, then verify `created_project` or `mapped_repo` and persist the actual returned project ID. Creation requires an OAuth grant with `mcp:write`; a read-only grant must not create or attach projects. Never substitute an invented ID or create a decision draft merely to provision a project.
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
- **When asked to discover or audit existing architectural, product, or business decisions from repository code and history**: **NEVER rely on a hosted LLM scan.** Follow the **Agent-Run Repository Decision Discovery** workflow below and read [references/repo-discovery-workflow.md](references/repo-discovery-workflow.md).

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
- Use the resolved project ID with `create_project_if_missing: false`; project provisioning belongs to the explicit setup step above.
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
- For repo-scoped drafts, pass the manifest's `repo_id` when present or its `repo_ref` otherwise.
- Before drafting, check `do-search-decisions` with `needs_review: true` and no search terms. Surface stale proposals or passed validation dates that affect the task. Page through the results when auditing the project.
- Include relevant paths or links among the search terms and compare overlapping records with the new decision. If it replaces an earlier record, add its ID to `supersedes`. If it only changes part of the earlier decision, link it in `related` and explain what changed.
- When an authorized commit implements a decision, confirm the relevant decision ID if it is unclear and add a `Decision: DEC-YYYY-NNNN` trailer for each ID. After pushing, use `do-get-decision` to check which commits linked. Use `do-update-decision-implementation` to mark completed work Built and record Verified or Failed when you have evidence for the decision’s metric. Include the evidence reference in the handoff.
- Create the draft with `decision-ops:do-create-decision-draft` and validate it with `decision-ops:do-validate-decision`.

5. Decide between `Proposed` (Needs Approval) vs `Accepted` (Decision Taken).
- **Keep as `Proposed` (Needs Approval — do NOT call `do-publish-decision` yet)** when the user asked an open/exploratory question (`"should we..."`, `"which option..."`, `"assess..."`) and has not confirmed which option to adopt, OR for a provisional RFC / `high`-risk proposal awaiting sign-off. Prefix `options[0]` with `[RECOMMENDED]`.
- **Publish as `Accepted` (Decision Taken — call `decision-ops:do-publish-decision`)** when:
  1. The user explicitly confirmed the choice or asked to implement it in the current turn, OR
  2. The user replies in a follow-up turn confirming an option from a `Proposed` decision (`"okay let's go with Option 1"`, `"yes let's implement that"`). Call `decision-ops:do-publish-decision` on that `decision_id` (passing `chosen_option_index` if they picked an option other than `options[0]`), which automatically promotes `[RECOMMENDED]` $\rightarrow$ `[CHOSEN]` and `Recommended Option:` $\rightarrow$ `Chosen Option:` and marks the decision **`Accepted`**.

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

## Agent-Run Repository Decision Discovery

When the user asks to discover, extract, or audit existing architectural, product, or business decisions from repository code and history, **never rely on a hosted LLM scan**. Execute the local agent-run discovery workflow:

1. **Read the Discovery Specification**:
   - Read [references/repo-discovery-workflow.md](references/repo-discovery-workflow.md) before inspecting the repository.
   - Briefly explain the scope to the user and do not promise an "exhaustive" account of every historical decision.
2. **Run Safe Zero-LLM Preflight & Context Resolution**:
   - Read `.decisionops/manifest.toml` when present (`org_id`, `project_id`, `repo_ref`, `default_branch`).
   - Call `decision-ops:do-discover-decisions` (which acts as a fast zero-LLM coverage and existing-decisions preflight) or `decision-ops:do-prepare-decision-gate` + `decision-ops:do-search-decisions` to retrieve existing DecisionOps decisions and repository coverage metadata without triggering a hosted LLM scan.
3. **Perform Local Multi-Source Investigation & Temporal Validity Verification (`temporal_check`)**:
   - Follow all **6 Mandatory Discovery Rules** in [references/repo-discovery-workflow.md](references/repo-discovery-workflow.md):
     1. **Search more than commits**: Inspect ADRs (`docs/adr/`, `adr/`, `ARCHITECTURE.md`), documentation, code/configuration manifests, commit messages and diffs, accessible PR discussions, and existing DecisionOps decisions.
     2. **Check present validity (`temporal_check`)**: For every historical candidate found in commits or PRs, inspect subsequent commits and the current `HEAD` tree on the target branch. Classify `candidate_status` as `current`, `superseded`, `reverted`, `proposed` (for open PRs), or `uncertain`, with a concrete `temporal_check.reason` and `checked_against_ref`. A merged commit is **not** automatically a still-current decision.
     3. **Keep claims narrow**: Write a plain-English `decision_statement` stating only the chosen approach and scope. Keep `"Why this was inferred"` (`rationale`) strictly separate from `decision_statement`. Never invent fake alternatives, metrics, deadlines (`90% in 30 days`), participants, or unsupported certainty.
     4. **Prefer abstention**: Omit routine code/library presence that does not reflect a non-trivial choice, or note it only as a factual observation. Mark `candidate_status: "uncertain"` when later changes cannot be checked.
     5. **Deduplicate before posting**: Group repeated commits/PRs for the same choice into one candidate, cross-check against existing DecisionOps decisions, and compute a deterministic `stable_import_key` (`<repo_ref>:<category>:<normalized-slug>`). Do NOT run $O(N^2)$ pairwise LLM edge inference; only include relationship edges (`depends-on`, `supersedes`, `conflicts`) backed by direct evidence.
     6. **Respect boundaries**: Never upload whole source files, secrets, or credentials. Include concise file/line or commit/PR references and short excerpts, flagging uncommitted local files with `local_only: true`.
4. **Present Evidence-Backed Candidates for User Review Before Import**:
   - Before calling `do-submit-discovery-candidates`, present the discovered candidates table to the user showing **Title & Narrow Decision Statement**, **Status** (`current|superseded|reverted|proposed|uncertain`), **Temporal Check** (`checked_against_ref` & reason), **Primary Evidence** (flagging `local_only: true` where applicable), and **Ambiguities**.
   - Explain clearly that submitted candidates land in DecisionOps as **unverified discovery drafts requiring explicit human acceptance** into the formal decision register, and ask the user which candidates to submit.
5. **Submit Approved Candidates via `decision-ops:do-submit-discovery-candidates`**:
   - Call `decision-ops:do-submit-discovery-candidates` with the user-approved candidates adhering to the 8-field Draft Contract in [references/repo-discovery-workflow.md](references/repo-discovery-workflow.md) and [references/mcp-interface.md](references/mcp-interface.md).
   - Render a complete summary of the submitted discovery candidate drafts and their DecisionOps review link in your response.

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
- Use the agent-run repository discovery specification in [references/repo-discovery-workflow.md](references/repo-discovery-workflow.md).
- Use the markdown structure in [references/decision-register-format.md](references/decision-register-format.md).
- Use the evaluation assets in [evals/trigger-queries.json](evals/trigger-queries.json) and [evals/evals.json](evals/evals.json) when validating activation and outcome quality.
