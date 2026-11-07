# Agent-Run Repository Decision Discovery Workflow

Use this specification whenever the user asks to discover, extract, or audit existing architectural, product, or business decisions in a repository.

All deep semantic analysis, repository history inspection, and temporal validity verification run **locally inside the coding agent** using the user's workspace and model allowance. Never rely on a hosted LLM scan to invent decisions for the repository.

---

## Core Promise & Scope Disclosure

Before starting a repository discovery pass, briefly tell the user what you will inspect and what to expect:
- Your coding agent will inspect local documentation/ADRs, configuration and code structure, recent Git history, accessible pull requests, and existing DecisionOps records.
- Every historical finding will be checked against the current branch (`HEAD`) to verify whether it still holds (`current`), was replaced (`superseded`), was rolled back (`reverted`), is still an open proposal (`proposed`), or cannot be verified (`uncertain`).
- Never claim that repository discovery produces a "full" or "exhaustive" record of all team decisions — important rationale may live only in conversations, tickets, external docs, or teammates' memories.
- Candidates you approve will be submitted via `do-submit-discovery-candidates` as **unverified discovery drafts** that require explicit human acceptance in the DecisionOps dashboard before becoming formal `Accepted` decisions.

---

## The 6 Mandatory Discovery Rules for the Agent

### 1. Search More Than Commits
Do not treat `git log` as your only source. Inspect across five layers of evidence:
1. **Explicit decision records & architecture docs**: `docs/adr/`, `adr/`, `docs/decisions/`, `ARCHITECTURE.md`, `DESIGN.md`, `README.md`, RFCs, and migration guides.
2. **Code & configuration manifests**: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, CI/CD workflows (`.github/workflows/`), infrastructure configs (`wrangler.toml`, `Dockerfile`, `terraform/`), database schemas/migrations, and feature-flag or routing tables.
3. **Commit messages & diffs**: Non-trivial architectural commits, dependency replacements, storage/schema migrations, and security or policy guardrails.
4. **Accessible PR discussions**: Open and merged pull requests (via `gh pr list` / `gh pr view` or MCP GitHub tools when available) to capture review tradeoffs and distinguish open proposals from merged code.
5. **Existing DecisionOps decisions**: Fetch existing project decisions first (via `do-discover-decisions` preflight or `do-search-decisions`) so you do not re-import already recorded decisions and can detect when new code supersedes an existing `DEC-YYYY-NNNN` record.

### 2. Check Present Validity (`temporal_check`)
A merged commit or old ADR is **not** automatically a still-current decision. For every historical candidate found in commits, PRs, or older docs, inspect later commits and the current `HEAD` tree on the target branch:
- Classify `candidate_status` as one of:
  - `current`: Verified present in the target branch `HEAD` tree and not reversed by later commits.
  - `superseded`: A real past decision that was later replaced by a different approach (cite the replacing commit, file, or decision).
  - `reverted`: A past commit or rollout that was explicitly rolled back or removed (cite the revert commit or removal diff).
  - `proposed`: Found in an open PR, draft RFC, or unmerged branch — not yet active on the target branch.
  - `uncertain`: The current state or subsequent history could not be verified (for example, shallow clone, missing directory, or ambiguous dual implementation).
- Populate `temporal_check` on every candidate with:
  - `checked_against_ref`: The branch/commit SHA inspected (e.g., `main@a1b2c3d` or `HEAD`).
  - `later_changes_examined`: Concrete summary of subsequent commits or current file paths checked (e.g., `git log <commit>..HEAD -- <paths>` and current file existence check).
  - `status_reason` (and `reason`): Plain-English explanation of why the candidate has its `candidate_status`.

### 3. Keep Claims Narrow
- Write a plain-English `decision_statement` describing **only** the chosen approach and its scope in the repository.
- Keep `"Why this was inferred"` (`rationale`) **strictly separate** from `decision_statement`. Never mix analyzer commentary ("Inferred from commit abc123...") into `decision_statement`.
- **Never invent** fake alternatives, unstated quantitative metrics, fabricated deadlines (such as `"90% in 30 days"`), unverified participants, or certainty that the repository evidence does not support. If alternatives or validation metrics were not stated in the evidence, say so plainly in `ambiguities[]` instead of fabricating them.

### 4. Prefer Abstention
- If repository evidence supports only *"this library, file, or code exists"* (routine boilerplate, standard language defaults, or trivial wiring) rather than *"the team made a non-trivial architectural, product, or operational choice"*, **omit it** or mention it only as a brief factual observation in chat — do **not** submit it as a decision candidate.
- If later commits or current branch state cannot be checked, downgrade `candidate_status` to `"uncertain"` rather than claiming `"current"`.

### 5. Deduplicate Before Posting
- Group repeated commits, follow-up fixes, and PRs that implement or refine the **same** architectural choice into **one** candidate with combined `evidence[]`.
- Cross-check every candidate against existing DecisionOps records returned by preflight/search. Skip duplicates that are already recorded unless the repository shows that an existing decision was `superseded` or `reverted`.
- Compute a deterministic `stable_import_key` for every candidate in the format:
  `<repo_ref>:<category>:<normalized-slug>`
  (for example, `acme/payments-api:technical:adopt-Cloudflare-d1-for-idempotency-journal`).
- **Do NOT run $O(N^2)$ pairwise LLM edge inference** across all candidates. Only include `relationships[]` (`depends-on`, `supersedes`, `conflicts`) when there is direct, concrete evidence linking two candidates or linking a candidate to an existing `DEC-YYYY-NNNN` record.

### 6. Respect Boundaries
- Read only repository files, Git history, and PRs that the user and coding agent already have permission to access.
- **Never** upload whole source files, raw secrets, `.env` values, API keys, bearer tokens, or private credentials.
- Submit only concise file/line references, commit SHAs, PR numbers/URLs, and short supporting excerpts (`<= 280` characters per evidence item), subject to the user's review before submission.
- If a piece of evidence comes from uncommitted working-tree changes or untracked local files that cannot be verified against the remote GitHub repository, set `local_only: true` on that evidence item so reviewers can see that it is local-only evidence.

---

## Step-by-Step Agent Discovery Flow

### Step 1: Resolve Context & Run Safe Preflight (Zero Hosted LLM Scan)
1. If `.decisionops/manifest.toml` exists, read `org_id`, `project_id`, `repo_ref`, and `default_branch`.
2. Call `decision-ops:do-discover-decisions` in **preflight/coverage mode** (`mode: "preflight"` or default safe preflight) — or call `decision-ops:do-prepare-decision-gate` followed by `decision-ops:do-search-decisions` — to:
   - Verify repository/project binding (`org_id`, `project_id`, `repo_ref`, `default_branch`),
   - Inspect factual source coverage and existing DecisionOps decisions/suggestions so you can deduplicate and detect supersession,
   - **Never** rely on hosted LLM scan output to invent decision claims.

### Step 2: Multi-Source Local Investigation & Temporal Verification
1. Inspect explicit decision docs (`docs/adr/`, `adr/`, `ARCHITECTURE.md`, RFCs), configuration manifests, key architectural modules, recent non-trivial commits (`git log --no-merges`), and accessible PRs.
2. For each potential decision, verify whether it is a genuine non-trivial choice (Rule 4: Prefer abstention).
3. Run the present-validity check against `HEAD` (`git log <source_sha>..HEAD -- <paths>` and current file inspection) to assign `candidate_status` (`current`, `superseded`, `reverted`, `proposed`, or `uncertain`) and record `temporal_check`.
4. Group related commits/PRs into deduplicated candidates and assign each candidate a deterministic `stable_import_key`.

### Step 3: Mandatory Human Review Before Import
**STOP before calling `do-submit-discovery-candidates`.** Present your findings clearly to the user and ask which candidates they want to submit:

1. Show a **Discovered Candidates Review Table** in your chat response with these columns:
   | # | Title & Narrow Decision Statement | Status (`current` \| `superseded` \| `reverted` \| `proposed` \| `uncertain`) | Temporal Check (`checked_against_ref` & reason) | Primary Evidence (files/commits/PRs; flag `local_only`) | Ambiguities / Missing Context |
2. For each candidate, keep **Decision Statement** separate from **Why This Was Inferred (`rationale`)**.
3. If you omitted trivial observations or low-evidence items, briefly note what you skipped and why.
4. Explain clearly to the user:
   > *"Approved candidates will be submitted to DecisionOps via `do-submit-discovery-candidates` as **unverified discovery drafts**. They will NOT be auto-published as formal `Accepted` decisions until a human explicitly reviews and accepts them in DecisionOps."*
5. Ask the user which candidates (by number, `"all"`, or `"only current"`) to submit to DecisionOps.

### Step 4: Submit Approved Candidates via `do-submit-discovery-candidates`
Once the user selects which candidates to import:
1. Call `decision-ops:do-submit-discovery-candidates` with the approved candidates matching the **8-Field Draft Contract** below.
2. Render a complete summary of the submitted discovery drafts (`suggestion_id` / `stable_import_key`, `candidate_status`, review status `pending_review`, and a link to review them in DecisionOps).

---

## 8-Field Draft Contract (`do-submit-discovery-candidates`)

Every candidate submitted in `candidates[]` to `do-submit-discovery-candidates` must satisfy the 8-part contract:

| # | Contract Area | Fields | Requirements |
| :--- | :--- | :--- | :--- |
| 1 | **Repository & Revision** | `repo_ref`, `branch`, `base_commit`, `analyzed_at` | Bind the run and each candidate to the repository (`owner/repo`), target branch, current `HEAD` commit SHA (`base_commit`), and ISO-8601 timestamp (`analyzed_at`). |
| 2 | **Title & Decision Statement** | `title`, `decision_statement`, `rationale`, `category`, `type` | `title` (`< 80` chars) and `decision_statement` state **only** the chosen approach and scope in plain English. `rationale` separately explains *why* the agent inferred this decision from the evidence. Never invent options or deadlines. |
| 3 | **Candidate Status** | `candidate_status` | Must be one of `"current"`, `"superseded"`, `"reverted"`, `"proposed"`, or `"uncertain"`. This represents temporal validity in the codebase and is distinct from the DecisionOps review state (`pending_review`). |
| 4 | **Evidence** | `evidence[]` (`kind`, `source`, `detail`, `excerpt`, `line_range`, `commit_sha`, `pr_number`, `local_only`) | At least one concrete source reference per candidate (`adr`, `documentation`, `file-content`, `config-value`, `dependency`, `git-commit`, `pull-request`). Keep `excerpt` concise (`<= 280` chars, no secrets). Set `local_only: true` for uncommitted local files. |
| 5 | **Temporal Check** | `temporal_check` (`checked_against_ref`, `later_changes_examined`, `reason`, `superseded_by_ref`, `reverted_by_ref`) | Required for every candidate. Records what later commits/files on `checked_against_ref` were checked and why the candidate is `current`, `superseded`, `reverted`, `proposed`, or `uncertain`. |
| 6 | **Scope & Ambiguities** | `scope` (`component`, `paths[]`, `missing_sources[]`), `ambiguities[]` | Identify affected repo paths, any unavailable sources (e.g., private PRs or issue tracker not accessible), and unresolved questions (`description`, `possible_interpretations[]`). |
| 7 | **Provenance** | `provenance` (`runner_type`, `agent_name`, `skill_version`, `source_locality`) | Set `runner_type: "agent"`, `skill_version: "2.2.0"`, and `source_locality: "local" | "remote" | "mixed"`. |
| 8 | **Stable Import Key** | `stable_import_key`, `relationships[]` | Deterministic key `<repo_ref>:<category>:<normalized-slug>` for idempotent retry and deduplication. Optional `relationships[]` (`target_key_or_decision_id`, `kind`: `depends-on\|supersedes\|conflicts`, `evidence_detail`) only when directly supported by evidence. |

### Example `do-submit-discovery-candidates` Payload

```json
{
  "org_id": "org_123",
  "project_id": "proj_456",
  "repo_ref": "acme/checkout-service",
  "branch": "main",
  "base_commit": "8f3d2a1c9e4b70123456789abcdef01234567890",
  "analyzed_at": "2026-10-26T04:30:00Z",
  "candidates": [
    {
      "stable_import_key": "acme/checkout-service:technical:sqlite-wal-idempotency-store",
      "title": "Use SQLite in WAL mode for local webhook idempotency deduplication",
      "decision_statement": "Store incoming Stripe webhook idempotency keys in a local SQLite database configured with Write-Ahead Logging (WAL) in src/storage/idempotency.ts, retaining keys for 72 hours.",
      "rationale": "Inferred from ADR-004 and commit 4b19e2a which replaced the earlier in-memory Map after duplicate webhook deliveries occurred across worker restarts.",
      "category": "data-storage",
      "type": "technical",
      "candidate_status": "current",
      "evidence": [
        {
          "kind": "adr",
          "source": "docs/adr/0004-webhook-idempotency-store.md",
          "line_range": "L1-L42",
          "detail": "ADR-004 documents the switch from in-memory deduplication to persistent SQLite WAL storage.",
          "excerpt": "We will persist webhook event IDs in SQLite with PRAGMA journal_mode=WAL to survive process restarts.",
          "local_only": false
        },
        {
          "kind": "file-content",
          "source": "src/storage/idempotency.ts",
          "line_range": "L14-L29",
          "commit_sha": "4b19e2a",
          "detail": "Current HEAD initializes SQLite WAL mode and enforces the 72-hour TTL cleanup query.",
          "local_only": false
        }
      ],
      "temporal_check": {
        "checked_against_ref": "main@8f3d2a1",
        "later_changes_examined": "Checked git log 4b19e2a..HEAD -- src/storage/idempotency.ts and verified src/webhooks/handler.ts still calls SqliteIdempotencyStore.",
        "reason": "The SQLite WAL store introduced in 4b19e2a remains wired into the production webhook handler at HEAD with no subsequent replacement."
      },
      "scope": {
        "component": "webhook-ingestion",
        "paths": [
          "docs/adr/0004-webhook-idempotency-store.md",
          "src/storage/idempotency.ts",
          "src/webhooks/handler.ts"
        ],
        "missing_sources": []
      },
      "ambiguities": [
        {
          "description": "Multi-instance horizontal scaling strategy is not specified in ADR-004.",
          "possible_interpretations": [
            "Service runs as a single-node deployment with attached volume.",
            "Team plans to migrate to Redis or Postgres if horizontal scaling is added later."
          ]
        }
      ],
      "provenance": {
        "runner_type": "agent",
        "agent_name": "coding-agent",
        "skill_version": "2.2.0",
        "source_locality": "local"
      },
      "relationships": []
    }
  ]
}
```
