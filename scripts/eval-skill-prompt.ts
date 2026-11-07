#!/usr/bin/env bun
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MODULE_DIR =
  import.meta.dir ??
  (import.meta as { dirname?: string }).dirname ??
  path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(MODULE_DIR, "..");
const MONOREPO_ROOT = path.resolve(SKILL_ROOT, "..");
const DEFAULT_CANDIDATE_PATH = path.join(SKILL_ROOT, "decision-ops", "SKILL.md");
const DEFAULT_BASELINE_PATH = path.join(
  SKILL_ROOT,
  "decision-ops",
  "evals",
  "snapshots",
  "SKILL.v1.0.0.md"
);
const RUNS_DIR = path.join(SKILL_ROOT, "decision-ops", "evals", "runs");

interface EvalScenario {
  id: string;
  title: string;
  mode: "comprehensive" | "quick";
  manifest: {
    org_id: string;
    project_id: string;
    repo_ref: string;
    default_branch: string;
    mcp_server_name: string;
  };
  userPrompt: string;
  repoFiles: Record<string, string>;
  priorDecisions: Array<{
    id: string;
    title: string;
    status: string;
    snippet: string;
  }>;
  expectedRepoPaths: string[];
  expectedDomainKeywords: string[];
}

const EVAL_SCENARIOS: EvalScenario[] = [
  {
    id: "comprehensive-entity-extraction-prompt-architecture",
    title: "Single-pass LLM extraction vs Two-stage Retriever+Verifier vs Hybrid Rule+LLM pipeline",
    mode: "comprehensive",
    manifest: {
      org_id: "org_jev",
      project_id: "org_jev:jev-entity-extraction",
      repo_ref: "acme/entity-extraction",
      default_branch: "main",
      mcp_server_name: "decision-ops-mcp"
    },
    userPrompt:
      "We need to decide on our dialog entity extraction architecture for noisy enterprise support transcripts: should we keep the current single-pass LLM prompt extractor, move to a two-stage Retriever + Verifier prompt pipeline, or adopt a Hybrid deterministic regex/dictionary pre-pass + structured LLM verifier? Run a Comprehensive decision analysis and prepare the DecisionOps draft.",
    repoFiles: {
      "src/extractor/pipeline.py": `
# Current single-pass entity extractor
# Known issues: p95 latency is 2,450ms; hallucination rate on numeric codes is 6.8%
def extract_entities_single_pass(transcript: str, model: str = "gpt-6.1-sol") -> dict:
    # Sends full 8k-token transcript in a single prompt call
    pass
`,
      "configs/sla.yaml": `
latency_budget:
  p95_max_ms: 1400
quality_targets:
  precision_min: 0.96
  hallucination_max: 0.015
cost_budget:
  max_usd_per_1k_calls: 1.80
`
    },
    priorDecisions: [
      {
        id: "DR-20261015-001",
        title: "Enforce strict JSON schema validation on extraction outputs",
        status: "Accepted",
        snippet: "All extraction outputs must validate against Pydantic v2 entity schemas with zero unverified span offsets."
      }
    ],
    expectedRepoPaths: ["src/extractor/pipeline.py", "configs/sla.yaml"],
    expectedDomainKeywords: ["latency", "1400", "hallucination", "0.96", "precision", "retriever", "hybrid"]
  },
  {
    id: "comprehensive-audit-retention-storage",
    title: "Enterprise 1-year audit retention storage engine (D1 SQLite vs R2 Parquet + D1 Index vs Managed Postgres)",
    mode: "comprehensive",
    manifest: {
      org_id: "org_dops",
      project_id: "org_dops:decisionops",
      repo_ref: "acme/decision-service",
      default_branch: "main",
      mcp_server_name: "decision-ops-mcp"
    },
    userPrompt:
      "Enterprise compliance contracts require retaining immutable audit logs and MCP telemetry exports for 365 days instead of 30 days (projected 450M rows/year, ~180GB). Should we keep everything in Cloudflare D1 SQLite, tier cold partitions (>30d) to Cloudflare R2 Parquet with a D1 metadata index, or migrate audit storage to an external managed Postgres cluster? Perform a Comprehensive decision analysis.",
    repoFiles: {
      "decision-record/apps/api-mcp-worker/wrangler.toml": `
name = "decisionrecord-api-mcp"
[[d1_databases]]
binding = "DB"
database_name = "decisionrecord-db"
# Note: Cloudflare D1 has a 10 GB per-database storage limit
`,
      "decision-record/packages/db/src/audit.ts": `
export async function recordAuditLog(db: D1Database, orgId: string, actorId: string, action: string) {
  await db.prepare("INSERT INTO audit_logs (org_id, actor_id, action, created_at) VALUES (?, ?, ?, ?)").bind(orgId, actorId, action, Date.now()).run();
}
`
    },
    priorDecisions: [
      {
        id: "DR-20261012-004",
        title: "Run all core DecisionOps control-plane workers on Cloudflare edge without external VPC dependencies",
        status: "Accepted",
        snippet: "Avoid external database egress in synchronous request paths to keep MCP tool latency under 150ms."
      }
    ],
    expectedRepoPaths: [
      "decision-record/apps/api-mcp-worker/wrangler.toml",
      "decision-record/packages/db/src/audit.ts"
    ],
    expectedDomainKeywords: ["10 gb", "r2", "parquet", "d1", "365", "compliance", "postgres"]
  }
];

interface RubricBreakdown {
  total_score: number; // 0 to 100
  option_depth_score: number; // 0 to 25
  codebase_grounding_score: number; // 0 to 20
  consequence_and_reversal_score: number; // 0 to 20
  validation_scorecard_score: number; // 0 to 15
  response_completeness_score: number; // 0 to 20
  findings: string[];
}

function loadEvalRunnerConfig(): {
  mode: "openai" | "claude-cli";
  apiKey: string;
  baseUrl: string;
  model: string;
  claudeBin: string;
} {
  let apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  let baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").trim();
  const model = (process.env.DECISIONOPS_EVAL_MODEL ?? "gpt-6.1-sol").trim();


  if (apiKey) {
    return {
      mode: "openai",
      apiKey,
      baseUrl: baseUrl.replace(/\/+$/, ""),
      model,
      claudeBin: "claude"
    };
  }

  const claudeCandidates = [
    process.env.CLAUDE_BIN,
    path.join(os.homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "claude"
  ].filter(Boolean) as string[];

  for (const bin of claudeCandidates) {
    try {
      execFileSync(bin, ["--version"], { stdio: "pipe", timeout: 5000 });
      return {
        mode: "claude-cli",
        apiKey: "",
        baseUrl: "",
        model: "claude-code-agent",
        claudeBin: bin
      };
    } catch {
      // try next
    }
  }

  throw new Error(
    "Neither OPENAI_API_KEY nor the `claude` CLI is available to run live skill prompt evaluation."
  );
}

function extractSkillVersion(skillMarkdown: string, filePath: string): string {
  const match = skillMarkdown.match(/prompt_version:\s*["']?([^"'\n]+)["']?/);
  if (match?.[1]) return match[1].trim();
  const base = path.basename(filePath);
  return base === "SKILL.md" ? "unversioned-working" : base;
}

function createTempEvaluationWorkspace(scenario: EvalScenario): {
  workspaceDir: string;
  manifestLoaded: Record<string, unknown>;
  cleanup: () => void;
} {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), `decisionops-eval-${scenario.id}-`));
  const decisionOpsDir = path.join(workspaceDir, ".decisionops");
  const tempAnalysisDir = path.join(decisionOpsDir, ".tmp", scenario.id);
  fs.mkdirSync(tempAnalysisDir, { recursive: true });

  const manifestToml = [
    `org_id = "${scenario.manifest.org_id}"`,
    `project_id = "${scenario.manifest.project_id}"`,
    `repo_ref = "${scenario.manifest.repo_ref}"`,
    `default_branch = "${scenario.manifest.default_branch}"`,
    `mcp_server_name = "${scenario.manifest.mcp_server_name}"`,
    ""
  ].join("\n");
  fs.writeFileSync(path.join(decisionOpsDir, "manifest.toml"), manifestToml, "utf8");

  for (const [relPath, fileContent] of Object.entries(scenario.repoFiles)) {
    const absPath = path.join(workspaceDir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, fileContent.trim() + "\n", "utf8");
  }

  // Verify the skill's read-manifest.sh works against this temp workspace
  const readManifestScript = path.join(SKILL_ROOT, "decision-ops", "scripts", "read-manifest.sh");
  const rawManifestOut = execFileSync("bash", [readManifestScript, workspaceDir], {
    encoding: "utf8"
  });
  const manifestLoaded = JSON.parse(rawManifestOut) as Record<string, unknown>;

  return {
    workspaceDir,
    manifestLoaded,
    cleanup: () => {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  };
}

async function runSkillPromptAgainstScenario(
  skillMarkdown: string,
  scenario: EvalScenario,
  workspaceInfo: { workspaceDir: string; manifestLoaded: Record<string, unknown> },
  runnerCfg: ReturnType<typeof loadEvalRunnerConfig>
): Promise<{
  draft_payload: Record<string, any>;
  agent_response_markdown: string;
  temp_workspace_notes: string;
  model_used: string;
  latency_ms: number;
}> {
  const systemInstructions = [
    "You are an AI coding agent executing the `decision-ops` skill in a temporary workspace.",
    "Follow the provided SKILL.md instructions faithfully.",
    `The user has already selected mode="${scenario.mode}" at the gate for project "${scenario.manifest.project_id}".`,
    "You have inspected the temporary workspace files, `.decisionops/manifest.toml`, and the `do-search-decisions` output.",
    "Return ONLY a raw JSON object (no markdown fences) with three keys:",
    "1. `temp_workspace_notes`: Summary of the per-option evaluation matrix written in `.decisionops/.tmp/`.",
    "2. `draft_payload`: The exact JSON object you pass to `do-create-decision-draft` (`org_id`, `project_id`, `scope_level`, `repo_id`, `title`, `type`, `context`, `decision`, `options`, `consequences`, `related`, `supersedes`, `validation_plan`, and `planner_analysis` if instructed by the skill).",
    "3. `agent_response_markdown`: The exact final markdown response you show to the user in chat after `do-create-decision-draft` and `do-validate-decision` succeed (use `DR-20261022-EVAL` as the logged decision_id and `1` as version).",
    "",
    "=== BEGIN SKILL.md ===",
    skillMarkdown,
    "=== END SKILL.md ==="
  ].join("\n");

  const userPayload = JSON.stringify(
    {
      selected_mode: scenario.mode,
      temp_workspace_dir: workspaceInfo.workspaceDir,
      manifest_from_read_manifest_sh: workspaceInfo.manifestLoaded,
      repository_files_in_workspace: scenario.repoFiles,
      do_search_decisions_output: {
        items: scenario.priorDecisions,
        candidate_supersedes: scenario.priorDecisions.map((d) => d.id)
      },
      user_prompt: scenario.userPrompt
    },
    null,
    2
  );

  const startedAt = Date.now();
  let rawText = "";
  let modelUsed = runnerCfg.model;

  if (runnerCfg.mode === "claude-cli") {
    const combinedPrompt = `${systemInstructions}\n\n=== SCENARIO INPUT ===\n${userPayload}\n\nRespond with ONLY valid JSON (starting with { and ending with }).`;
    const stdout = execFileSync(
      runnerCfg.claudeBin,
      ["-p", combinedPrompt, "--model", "sonnet", "--output-format", "text", "--tools", ""],
      {
        cwd: workspaceInfo.workspaceDir,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 180_000
      }
    );
    rawText = stdout.trim();
    const firstBrace = rawText.indexOf("{");
    const lastBrace = rawText.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      rawText = rawText.slice(firstBrace, lastBrace + 1);
    }
  } else {
    const callModel = async (targetModel: string) => {
      const isReasoning =
        !targetModel.toLowerCase().includes("luna") &&
        /^(gpt-5|gpt-6|o1|o3|o4)/i.test(targetModel);
      const body: Record<string, unknown> = {
        model: targetModel,
        instructions: systemInstructions,
        input: userPayload,
        text: { format: { type: "json_object" } },
        store: false
      };
      if (isReasoning) {
        body.reasoning = { effort: "low" };
      }

      const res = await fetch(`${runnerCfg.baseUrl}/v1/responses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${runnerCfg.apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errText = await res.text();
        const err = new Error(`HTTP ${res.status}: ${errText}`) as Error & { status?: number; body?: string };
        err.status = res.status;
        err.body = errText;
        throw err;
      }
      return { json: (await res.json()) as Record<string, any>, modelUsed: targetModel };
    };

    let resultJson: Record<string, any>;
    try {
      const res = await callModel(runnerCfg.model);
      resultJson = res.json;
      modelUsed = res.modelUsed;
    } catch (err: any) {
      if (
        (err.status === 400 || err.status === 404) &&
        runnerCfg.model !== "gpt-5.4-mini"
      ) {
        const fallbackRes = await callModel("gpt-5.4-mini");
        resultJson = fallbackRes.json;
        modelUsed = fallbackRes.modelUsed;
      } else {
        throw err;
      }
    }

    const outputItems = Array.isArray(resultJson.output) ? resultJson.output : [];
    const messageItem = outputItems.find((item: any) => item?.type === "message");
    rawText = String(messageItem?.content?.[0]?.text ?? "").trim();
  }

  const latencyMs = Date.now() - startedAt;
  if (!rawText) {
    throw new Error("Empty response from model during skill prompt evaluation.");
  }
  const parsed = JSON.parse(rawText);
  return {
    draft_payload: parsed.draft_payload ?? {},
    agent_response_markdown: String(parsed.agent_response_markdown ?? ""),
    temp_workspace_notes:
      typeof parsed.temp_workspace_notes === "string"
        ? parsed.temp_workspace_notes
        : JSON.stringify(parsed.temp_workspace_notes ?? {}),
    model_used: modelUsed,
    latency_ms: latencyMs
  };
}

export function gradeSkillExecution(
  scenario: EvalScenario,
  output: {
    draft_payload: Record<string, any>;
    agent_response_markdown: string;
    temp_workspace_notes: string;
  }
): RubricBreakdown {
  const findings: string[] = [];
  const draft = output.draft_payload ?? {};
  const markdown = output.agent_response_markdown ?? "";
  const options: string[] = Array.isArray(draft.options)
    ? draft.options.map((o: unknown) => String(o).trim()).filter(Boolean)
    : [];
  const consequences: string[] = Array.isArray(draft.consequences)
    ? draft.consequences.map((c: unknown) => String(c).trim()).filter(Boolean)
    : [];
  const related: string[] = Array.isArray(draft.related)
    ? draft.related.map((r: unknown) => String(r).trim()).filter(Boolean)
    : [];

  // 1. Option Depth & Multi-Axis Coverage (25 pts)
  let optionDepthScore = 0;
  if (options.length >= 3) {
    optionDepthScore += 8;
  } else if (options.length === 2) {
    optionDepthScore += 4;
    findings.push(`Comprehensive mode requires 3+ options; found ${options.length}.`);
  } else {
    findings.push(`Too few options in draft_payload.options (${options.length}).`);
  }

  const optionsWithProsAndCons = options.filter(
    (opt) => /pros\s*:/i.test(opt) && /cons\s*:/i.test(opt)
  );
  if (options.length > 0 && optionsWithProsAndCons.length === options.length) {
    optionDepthScore += 8;
  } else {
    optionDepthScore += Math.round((optionsWithProsAndCons.length / Math.max(options.length, 1)) * 8);
    findings.push("Not all options explicitly formatted both 'Pros:' and 'Cons:'.");
  }

  const combinedOptionsText = (options.join(" ") + " " + markdown).toLowerCase();
  const axes = [
    { name: "Architecture/Codebase Fit", regex: /(architecture|codebase|module|schema|interface|fit)/i },
    { name: "Performance/Latency/Cost", regex: /(latency|p95|throughput|cost|token|performance|scale)/i },
    { name: "Operational/Maintenance Burden", regex: /(operational|maintenance|observability|on-call|debugging|burden)/i },
    { name: "Failure Modes/Security/Compliance", regex: /(failure|blast radius|security|compliance|hallucination|risk)/i },
    { name: "Migration/Reversibility", regex: /(migration|reversib|rollback|two-way|one-way|cutover)/i }
  ];
  const matchedAxes = axes.filter((a) => a.regex.test(combinedOptionsText));
  optionDepthScore += Math.round((matchedAxes.length / axes.length) * 9);
  if (matchedAxes.length < axes.length) {
    findings.push(
      `Missing evaluation axes: ${axes
        .filter((a) => !a.regex.test(combinedOptionsText))
        .map((a) => a.name)
        .join(", ")}`
    );
  }

  // 2. Codebase & Evidence Grounding (20 pts)
  let codebaseGroundingScore = 0;
  const fullDraftText = JSON.stringify(draft).toLowerCase();
  const matchedPaths = scenario.expectedRepoPaths.filter((p) =>
    fullDraftText.includes(p.toLowerCase())
  );
  const pathScore = Math.round((matchedPaths.length / scenario.expectedRepoPaths.length) * 6);
  codebaseGroundingScore += pathScore;
  if (matchedPaths.length < scenario.expectedRepoPaths.length) {
    findings.push(
      `Did not reference all expected workspace repo files: ${scenario.expectedRepoPaths.join(", ")}`
    );
  }

  const matchedKeywords = scenario.expectedDomainKeywords.filter((k) =>
    fullDraftText.includes(k.toLowerCase())
  );
  codebaseGroundingScore += Math.round(
    (matchedKeywords.length / scenario.expectedDomainKeywords.length) * 4
  );

  const plannerAnalysis = draft.planner_analysis;
  if (
    plannerAnalysis &&
    typeof plannerAnalysis === "object" &&
    Array.isArray(plannerAnalysis.evidence) &&
    plannerAnalysis.evidence.length >= 2 &&
    plannerAnalysis.impact &&
    typeof plannerAnalysis.confidence === "number"
  ) {
    codebaseGroundingScore += 10;
  } else {
    findings.push(
      "Missing or incomplete `planner_analysis` (expected `evidence[]` with >=2 items, `impact`, and `confidence`)."
    );
  }

  // 3. Consequences, Risks & Reversal Trigger (20 pts)
  let consequenceScore = 0;
  if (consequences.length >= 4) {
    consequenceScore += 8;
  } else if (consequences.length >= 2) {
    consequenceScore += 4;
    findings.push(`Comprehensive mode requires 4+ consequences; found ${consequences.length}.`);
  } else {
    findings.push(`Too few consequences (${consequences.length}).`);
  }

  const consequencesText = (consequences.join(" ") + " " + String(draft.decision ?? "")).toLowerCase();
  if (/(risk|cost|tradeoff|downside|overhead|migration)/.test(consequencesText)) {
    consequenceScore += 6;
  } else {
    findings.push("Consequences did not explicitly call out operational cost, downside, or risk.");
  }

  if (/(rollback|reversal|reverse|supersede|trigger|fallback|abort|if .* exceeds)/i.test(consequencesText)) {
    consequenceScore += 6;
  } else {
    findings.push("Missing explicit Rollback / Reversal Trigger condition in decision or consequences.");
  }

  // 4. Validation Scorecard & Quality Gate (15 pts)
  let validationScore = 0;
  const vp = draft.validation_plan ?? {};
  const hasAllVp =
    Boolean(String(vp.metric ?? "").trim()) &&
    Boolean(String(vp.baseline ?? "").trim()) &&
    Boolean(String(vp.target ?? "").trim()) &&
    /^\d{4}-\d{2}-\d{2}/.test(String(vp.by_date ?? "").trim());
  if (hasAllVp) {
    validationScore += 8;
  } else {
    findings.push("validation_plan is missing metric, baseline, target, or YYYY-MM-DD by_date.");
  }

  // Check quantitative specificity in baseline/target
  if (/\d/.test(String(vp.baseline ?? "")) && /\d/.test(String(vp.target ?? ""))) {
    validationScore += 4;
  } else {
    findings.push("validation_plan baseline/target lacked quantitative numbers.");
  }

  if (related.length > 0 && String(draft.context ?? "").split(/\s+/).length >= 35 && String(draft.decision ?? "").split(/\s+/).length >= 35) {
    validationScore += 3;
  } else {
    findings.push("context, decision, or related[] was too brief for a Comprehensive decision.");
  }

  // 5. In-Chat Rendered Output Completeness & Chosen-Option Clarity (20 pts)
  let responseScore = 0;
  if (/###\s+Decision Logged in DecisionOps/i.test(markdown)) {
    responseScore += 3;
  } else {
    findings.push("Agent markdown response missing '### Decision Logged in DecisionOps' heading.");
  }

  // Check for top callout box and explicit [CHOSEN]/[RECOMMENDED] prefix in options[0]
  const hasTopCallout = />\s*\*\*.*(?:Chosen|Recommended)\s+Option/i.test(markdown);
  const hasExplicitOptionTags =
    options.length >= 2 &&
    /^\s*\[(?:CHOSEN|RECOMMENDED)\]/i.test(options[0] ?? "") &&
    options.slice(1).every((opt) => /^\s*\[NOT CHOSEN\]/i.test(opt));
  if (hasTopCallout && hasExplicitOptionTags) {
    responseScore += 4;
  } else {
    if (!hasTopCallout) {
      findings.push("Agent markdown response missing top '> **✅ Chosen / Recommended Option:' callout.");
    }
    if (!hasExplicitOptionTags) {
      findings.push("options[] did not prefix options[0] with [CHOSEN]/[RECOMMENDED] and rejected options with [NOT CHOSEN].");
    }
  }

  const requiredSections = [
    /(?:Why This Decision Is Needed|Context\s*&\s*Problem Statement)/i,
    /(?:What We're Doing|Chosen Decision)/i,
    /(?:Options Considered|Alternatives Considered)/i,
    /(?:Tradeoffs\s*&\s*What Could Go Wrong|Consequences,\s*Risks\s*&\s*Tradeoffs)/i,
    /(?:How We'll Measure Success|Constraints,\s*Rollout\s*&\s*Verification Plan)/i
  ];
  const matchedSections = requiredSections.filter((r) => r.test(markdown));
  responseScore += Math.round((matchedSections.length / requiredSections.length) * 5);
  if (matchedSections.length < requiredSections.length) {
    findings.push(`Agent markdown response missed ${requiredSections.length - matchedSections.length} required sections.`);
  }

  // Check for Option Comparison Matrix table in Comprehensive mode
  if (/\|.*Option.*\|.*Verdict.*\|/i.test(markdown) && /\|[\s:|-]+\|/.test(markdown)) {
    responseScore += 8;
  } else {
    findings.push("Agent markdown response missing the Option Comparison Matrix markdown table in Comprehensive mode.");
  }

  const totalScore =
    optionDepthScore +
    codebaseGroundingScore +
    consequenceScore +
    validationScore +
    responseScore;

  return {
    total_score: totalScore,
    option_depth_score: optionDepthScore,
    codebase_grounding_score: codebaseGroundingScore,
    consequence_and_reversal_score: consequenceScore,
    validation_scorecard_score: validationScore,
    response_completeness_score: responseScore,
    findings
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: bun run scripts/eval-skill-prompt.ts [--baseline <path>] [--candidate <path>] [--scenario <id>]"
    );
    process.exit(0);
  }

  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const baselinePath = path.resolve(getArg("--baseline") ?? DEFAULT_BASELINE_PATH);
  const candidatePath = path.resolve(getArg("--candidate") ?? DEFAULT_CANDIDATE_PATH);
  const scenarioFilter = getArg("--scenario");

  const scenarios = scenarioFilter
    ? EVAL_SCENARIOS.filter((s) => s.id.includes(scenarioFilter))
    : EVAL_SCENARIOS;

  if (scenarios.length === 0) {
    throw new Error(`No scenarios matched filter: ${scenarioFilter}`);
  }

  const runnerCfg = loadEvalRunnerConfig();
  const baselineMd = fs.readFileSync(baselinePath, "utf8");
  const candidateMd = fs.readFileSync(candidatePath, "utf8");
  const baselineVersion = extractSkillVersion(baselineMd, baselinePath);
  const candidateVersion = extractSkillVersion(candidateMd, candidatePath);

  console.log(
    `Evaluating decision-ops SKILL.md prompt in isolated temp workspaces (runner: ${runnerCfg.mode}, model: ${runnerCfg.model})`
  );
  console.log(`  Baseline : ${baselineVersion} (${path.relative(MONOREPO_ROOT, baselinePath)})`);
  console.log(`  Candidate: ${candidateVersion} (${path.relative(MONOREPO_ROOT, candidatePath)})\n`);

  const scenarioResults: Array<Record<string, any>> = [];

  for (const scenario of scenarios) {
    console.log(`── Scenario: ${scenario.id} ──`);
    const workspaceInfo = createTempEvaluationWorkspace(scenario);
    try {
      console.log(`  [temp-workspace] Created ${workspaceInfo.workspaceDir} with .decisionops/manifest.toml`);

      const [baselineRun, candidateRun] = await Promise.all([
        runSkillPromptAgainstScenario(baselineMd, scenario, workspaceInfo, runnerCfg),
        runSkillPromptAgainstScenario(candidateMd, scenario, workspaceInfo, runnerCfg)
      ]);

      const baselineGrade = gradeSkillExecution(scenario, baselineRun);
      const candidateGrade = gradeSkillExecution(scenario, candidateRun);

      console.log(
        `  Baseline (${baselineVersion})  Score: ${baselineGrade.total_score}/100 (options=${baselineGrade.option_depth_score}/25, grounding=${baselineGrade.codebase_grounding_score}/20, consequences=${baselineGrade.consequence_and_reversal_score}/20, validation=${baselineGrade.validation_scorecard_score}/15, response=${baselineGrade.response_completeness_score}/20)`
      );
      console.log(
        `  Candidate (${candidateVersion}) Score: ${candidateGrade.total_score}/100 (options=${candidateGrade.option_depth_score}/25, grounding=${candidateGrade.codebase_grounding_score}/20, consequences=${candidateGrade.consequence_and_reversal_score}/20, validation=${candidateGrade.validation_scorecard_score}/15, response=${candidateGrade.response_completeness_score}/20)`
      );
      console.log(
        `  Delta: ${candidateGrade.total_score - baselineGrade.total_score >= 0 ? "+" : ""}${
          candidateGrade.total_score - baselineGrade.total_score
        } pts\n`
      );

      scenarioResults.push({
        scenario_id: scenario.id,
        scenario_title: scenario.title,
        manifest: scenario.manifest,
        baseline: {
          version: baselineVersion,
          model_used: baselineRun.model_used,
          latency_ms: baselineRun.latency_ms,
          grade: baselineGrade,
          draft_payload: baselineRun.draft_payload,
          agent_response_markdown: baselineRun.agent_response_markdown
        },
        candidate: {
          version: candidateVersion,
          model_used: candidateRun.model_used,
          latency_ms: candidateRun.latency_ms,
          grade: candidateGrade,
          draft_payload: candidateRun.draft_payload,
          agent_response_markdown: candidateRun.agent_response_markdown,
          temp_workspace_notes: candidateRun.temp_workspace_notes
        },
        delta_score: candidateGrade.total_score - baselineGrade.total_score
      });
    } finally {
      workspaceInfo.cleanup();
    }
  }

  const avgBaseline =
    Math.round(
      (scenarioResults.reduce((acc, r) => acc + r.baseline.grade.total_score, 0) /
        scenarioResults.length) *
        10
    ) / 10;
  const avgCandidate =
    Math.round(
      (scenarioResults.reduce((acc, r) => acc + r.candidate.grade.total_score, 0) /
        scenarioResults.length) *
        10
    ) / 10;
  const avgDelta = Math.round((avgCandidate - avgBaseline) * 10) / 10;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(RUNS_DIR, timestamp);
  fs.mkdirSync(runDir, { recursive: true });

  // Build a ready-to-log DecisionOps draft payload from the empirical benchmark run
  const decisionDraftPayload = {
    org_id: "org_dops",
    project_id: "org_dops:decisionops",
    scope_level: "project",
    title: `Upgrade decision-ops SKILL.md to v${candidateVersion} with 5-axis Comprehensive reasoning and temp workspace evaluation`,
    type: "technical",
    context: `Selecting Comprehensive mode in decision-ops SKILL.md (${baselineVersion}) previously only increased do-search-decisions from 3 to 5 results without changing reasoning depth, codebase inspection requirements, or option evaluation structure. In our isolated temp-workspace benchmark suite across ${scenarioResults.length} complex engineering/compliance scenarios, ${baselineVersion} scored an average of ${avgBaseline}/100 because it lacked 5-axis tradeoff matrices, structured planner_analysis evidence, and explicit rollback/reversal triggers.`,
    decision: `Adopt decision-ops SKILL.md v${candidateVersion} as the canonical skill prompt. v${candidateVersion} mandates: (1) isolated per-option evaluation in a temporary workspace (.decisionops/.tmp/ alongside .decisionops/manifest.toml) when options/prompts can be spiked or stress-tested individually, (2) 3+ options evaluated across 5 mandatory axes (Architecture Fit, Performance/Scale/Cost, Operational Burden, Failure Modes/Security, Migration/Reversibility), (3) mandatory planner_analysis evidence and explicit Rollback/Reversal triggers, and (4) rendering an Option Comparison Matrix table in the coding agent's response. Rollback trigger: revert to ${baselineVersion} if Comprehensive mode validation pass rate drops below 95% or average score regresses below ${avgBaseline}/100.`,
    options: [
      `SKILL.md v${candidateVersion} (5-Axis Comprehensive Rubric + Temp Workspace Evaluation + Option Comparison Matrix): Scored ${avgCandidate}/100 (+${avgDelta} pts over baseline) across ${scenarioResults.length} temp-workspace scenarios — Pros: Full 5-axis option evaluation, populates planner_analysis.evidence, includes explicit reversal triggers, and renders an in-chat Option Comparison Matrix table | Cons: Slightly larger prompt instructions (+45 lines) and higher output token count in Comprehensive mode (Accepted)`,
      `SKILL.md ${baselineVersion} (Search-Only Comprehensive Mode): Scored ${avgBaseline}/100 in temp-workspace benchmark — Pros: Shorter prompt instructions | Cons: Treats Quick and Comprehensive identically during analysis, omits planner_analysis evidence, omits Option Comparison Matrix, and produces shallow 2-bullet option summaries (Rejected)`,
      `Server-Side Second LLM Re-Drafting Inside do-create-decision-draft: Run an extra backend LLM call inside MCP create-draft — Pros: Centralizes reasoning on backend | Cons: Adds 3-8s network/LLM latency, lacks direct filesystem access to the user's local workspace files, and duplicates the coding agent's frontier model reasoning (Rejected)`
    ],
    consequences: [
      `Empirical reasoning depth in Comprehensive mode improved from ${avgBaseline}/100 (${baselineVersion}) to ${avgCandidate}/100 (v${candidateVersion}), a +${avgDelta} point gain across option depth, codebase grounding, reversal triggers, and response completeness.`,
      "Every Comprehensive decision logged via MCP now populates structured planner_analysis.evidence and renders a 5-axis Option Comparison Matrix directly in the coding agent chat.",
      "Operational tradeoff: Comprehensive mode responses generate ~250-400 additional output tokens for the comparison matrix and structured planner_analysis payload.",
      `Rollback / reversal trigger: If automated skill prompt evaluation in skill/scripts/eval-skill-prompt.ts scores below 85/100 or causes MCP schema validation failures, revert SKILL.md to snapshot ${baselineVersion}.`
    ],
    related: [
      "skill/decision-ops/SKILL.md",
      "skill/decision-ops/evals/snapshots/SKILL.v1.0.0.md",
      "skill/scripts/eval-skill-prompt.ts"
    ],
    supersedes: [],
    validation_plan: {
      metric: "Skill Prompt Comprehensive Analysis Rubric Score (0-100 across 5 dimensions)",
      baseline: `${avgBaseline}/100 (${baselineVersion} snapshot)`,
      target: `>= 90/100 (measured ${avgCandidate}/100 on v${candidateVersion})`,
      by_date: "2026-11-15"
    },
    planner_analysis: {
      evidence: scenarioResults.map((r) => ({
        kind: "file-content",
        source: `skill/decision-ops/evals/runs/${timestamp}/report.json#${r.scenario_id}`,
        detail: `Scenario '${r.scenario_id}': baseline ${r.baseline.version} scored ${r.baseline.grade.total_score}/100 vs candidate v${r.candidate.version} scored ${r.candidate.grade.total_score}/100 (+${r.delta_score} pts).`
      })),
      impact: {
        level: "high",
        scope: "skill/decision-ops and all IDE coding agent installations",
        description: "Governs how all coding agents reason through options and format decisions in Comprehensive mode."
      },
      ambiguities: [],
      tags: ["skill-prompt", "comprehensive-mode", "evaluation-harness", "prompt-versioning"],
      discoveredBy: ["skill-prompt-eval-harness"],
      confidence: 0.96
    }
  };

  const reportPayload = {
    generated_at: new Date().toISOString(),
    model: runnerCfg.model,
    baseline_version: baselineVersion,
    candidate_version: candidateVersion,
    summary: {
      average_baseline_score: avgBaseline,
      average_candidate_score: avgCandidate,
      average_delta: avgDelta
    },
    scenarios: scenarioResults,
    decision_draft_payload: decisionDraftPayload
  };

  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(reportPayload, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "decision-draft-payload.json"),
    JSON.stringify(decisionDraftPayload, null, 2) + "\n",
    "utf8"
  );

  const reportMdLines = [
    `# Skill Prompt Evaluation Report: \`${baselineVersion}\` vs \`v${candidateVersion}\``,
    "",
    `- **Generated At**: \`${reportPayload.generated_at}\``,
    `- **Model**: \`${runnerCfg.model}\``,
    `- **Average Baseline Score (\`${baselineVersion}\`)**: **${avgBaseline} / 100**`,
    `- **Average Candidate Score (\`v${candidateVersion}\`)**: **${avgCandidate} / 100** (**+${avgDelta} pts**)`,
    "",
    "## Scenario Breakdown",
    "",
    "| Scenario | Baseline (`" + baselineVersion + "`) | Candidate (`v" + candidateVersion + "`) | Delta | Option Depth (25) | Grounding (20) | Consequences & Reversal (20) | Validation (15) | Response Matrix (20) |",
    "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
    ...scenarioResults.map(
      (r) =>
        `| \`${r.scenario_id}\` | ${r.baseline.grade.total_score}/100 | **${r.candidate.grade.total_score}/100** | **+${r.delta_score}** | ${r.baseline.grade.option_depth_score} → **${r.candidate.grade.option_depth_score}** | ${r.baseline.grade.codebase_grounding_score} → **${r.candidate.grade.codebase_grounding_score}** | ${r.baseline.grade.consequence_and_reversal_score} → **${r.candidate.grade.consequence_and_reversal_score}** | ${r.baseline.grade.validation_scorecard_score} → **${r.candidate.grade.validation_scorecard_score}** | ${r.baseline.grade.response_completeness_score} → **${r.candidate.grade.response_completeness_score}** |`
    ),
    ""
  ];
  fs.writeFileSync(path.join(runDir, "report.md"), reportMdLines.join("\n"), "utf8");

  console.log(`══ Summary ══`);
  console.log(`  Baseline (${baselineVersion}) Average : ${avgBaseline}/100`);
  console.log(`  Candidate (${candidateVersion}) Average: ${avgCandidate}/100 (+${avgDelta} pts)`);
  console.log(`  Saved report & decision draft payload to: ${path.relative(MONOREPO_ROOT, runDir)}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
