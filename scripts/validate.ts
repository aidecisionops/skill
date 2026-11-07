import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const MODULE_DIR = import.meta.dir ?? (import.meta as { dirname?: string }).dirname ?? path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(MODULE_DIR, "..");
const SKILL_DIR = path.join(ROOT, "decision-ops");

const errors: string[] = [];

function fail(msg: string) {
  errors.push(msg);
}

function info(msg: string) {
  console.log(`  [info] ${msg}`);
}

function ok(msg: string) {
  console.log(`  [ok]   ${msg}`);
}

// ── SKILL.md ──

function validateSkillMd() {
  console.log("\n── SKILL.md ──");
  const skillPath = path.join(SKILL_DIR, "SKILL.md");
  if (!fs.existsSync(skillPath)) {
    fail("SKILL.md not found");
    return;
  }

  const content = fs.readFileSync(skillPath, "utf8");
  const lines = content.split("\n");

  // Parse frontmatter
  if (lines[0]?.trim() !== "---") {
    fail("SKILL.md must start with --- frontmatter delimiter");
    return;
  }

  const endIdx = lines.indexOf("---", 1);
  if (endIdx < 0) {
    fail("SKILL.md frontmatter missing closing ---");
    return;
  }

  const frontmatter = lines.slice(1, endIdx).join("\n");

  // Extract name
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  if (!nameMatch) {
    fail("SKILL.md frontmatter missing 'name'");
    return;
  }
  const name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    fail(`SKILL.md name '${name}' is not kebab-case (lowercase letters, digits, hyphens)`);
  } else {
    ok(`name: ${name}`);
  }

  // Extract description
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  if (!descMatch) {
    fail("SKILL.md frontmatter missing 'description'");
    return;
  }
  const desc = descMatch[1].trim().replace(/^["']|["']$/g, "");
  if (desc.length > 1024) {
    fail(`SKILL.md description is ${desc.length} chars (max 1024)`);
  } else {
    ok(`description: ${desc.length} chars`);
  }

  // Body line count (after frontmatter)
  const bodyLines = lines.slice(endIdx + 1);
  if (bodyLines.length > 500) {
    fail(`SKILL.md body has ${bodyLines.length} lines (max 500)`);
  } else {
    ok(`body: ${bodyLines.length} lines`);
  }
}

// ── trigger-queries.json ──

function validateTriggerQueries() {
  console.log("\n── trigger-queries.json ──");
  const tqPath = path.join(SKILL_DIR, "evals", "trigger-queries.json");
  if (!fs.existsSync(tqPath)) {
    fail("evals/trigger-queries.json not found");
    return;
  }

  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(tqPath, "utf8"));
  } catch (e) {
    fail(`evals/trigger-queries.json is not valid JSON: ${e}`);
    return;
  }

  const positive = data.positive;
  const negative = data.negative;

  if (!Array.isArray(positive) || positive.length < 10) {
    fail(`trigger-queries.json needs 10+ positive cases (found ${Array.isArray(positive) ? positive.length : 0})`);
  } else {
    ok(`positive: ${positive.length} cases`);
  }

  if (!Array.isArray(negative) || negative.length < 10) {
    fail(`trigger-queries.json needs 10+ negative cases (found ${Array.isArray(negative) ? negative.length : 0})`);
  } else {
    ok(`negative: ${negative.length} cases`);
  }

  // Validate each entry has id, prompt, why
  for (const list of [positive, negative]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry.id || !entry.prompt || !entry.why) {
        fail(`trigger-queries.json entry missing id/prompt/why: ${JSON.stringify(entry)}`);
      }
    }
  }
  ok("all entries have id, prompt, why");
}

// ── evals.json ──

function validateEvals() {
  console.log("\n── evals.json ──");
  const evalsPath = path.join(SKILL_DIR, "evals", "evals.json");
  if (!fs.existsSync(evalsPath)) {
    fail("evals/evals.json not found");
    return;
  }

  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(evalsPath, "utf8"));
  } catch (e) {
    fail(`evals/evals.json is not valid JSON: ${e}`);
    return;
  }

  if (data.version !== 1) {
    fail(`evals.json version must be 1 (found ${data.version})`);
  } else {
    ok("version: 1");
  }

  if (!data.methodology) {
    fail("evals.json missing 'methodology'");
  } else {
    ok("methodology present");
  }

  const cases = data.cases;
  if (!Array.isArray(cases) || cases.length < 2) {
    fail(`evals.json needs 2+ cases (found ${Array.isArray(cases) ? cases.length : 0})`);
  } else {
    ok(`cases: ${cases.length}`);
  }

  if (Array.isArray(cases)) {
    for (const c of cases) {
      if (!Array.isArray(c.expected_behavior) || c.expected_behavior.length === 0) {
        fail(`evals.json case '${c.id}' missing expected_behavior`);
      }
      if (!Array.isArray(c.rubric) || c.rubric.length === 0) {
        fail(`evals.json case '${c.id}' missing rubric`);
      }
    }
    ok("all cases have expected_behavior and rubric");
  }
}

// ── agents/openai.yaml ──

function validateOpenaiYaml() {
  console.log("\n── agents/openai.yaml ──");
  const yamlPath = path.join(SKILL_DIR, "agents", "openai.yaml");
  if (!fs.existsSync(yamlPath)) {
    fail("agents/openai.yaml not found");
    return;
  }

  const content = fs.readFileSync(yamlPath, "utf8");

  // Simple YAML parsing for the fields we need
  const displayNameMatch = content.match(/display_name:\s*["']?([^"'\n]+)["']?/);
  if (!displayNameMatch) {
    fail("openai.yaml missing interface.display_name");
  } else {
    ok(`display_name: ${displayNameMatch[1].trim()}`);
  }

  const shortDescMatch = content.match(/short_description:\s*["']?([^"'\n]+)["']?/);
  if (!shortDescMatch) {
    fail("openai.yaml missing interface.short_description");
  } else {
    const shortDesc = shortDescMatch[1].trim().replace(/^["']|["']$/g, "");
    if (shortDesc.length < 25 || shortDesc.length > 64) {
      fail(`openai.yaml short_description is ${shortDesc.length} chars (must be 25-64)`);
    } else {
      ok(`short_description: ${shortDesc.length} chars`);
    }
  }

  const promptMatch = content.match(/default_prompt:\s*["']?(.+)/s);
  if (!promptMatch) {
    fail("openai.yaml missing interface.default_prompt");
  } else {
    const prompt = promptMatch[1].trim();
    // Extract skill name from SKILL.md
    const skillMdPath = path.join(SKILL_DIR, "SKILL.md");
    if (fs.existsSync(skillMdPath)) {
      const skillContent = fs.readFileSync(skillMdPath, "utf8");
      const nameMatch = skillContent.match(/^name:\s*(.+)$/m);
      if (nameMatch) {
        const skillName = nameMatch[1].trim().replace(/^["']|["']$/g, "");
        const ref = `$${skillName}`;
        if (!prompt.includes(ref)) {
          fail(`openai.yaml default_prompt does not reference ${ref}`);
        } else {
          ok(`default_prompt references ${ref}`);
        }
      }
    }
  }
}

// ── scripts --help ──

function validateScripts() {
  console.log("\n── scripts ──");
  const scriptsDir = path.join(SKILL_DIR, "scripts");
  if (!fs.existsSync(scriptsDir)) {
    fail("scripts/ directory not found");
    return;
  }

  const scripts = fs.readdirSync(scriptsDir).filter((f) => f.endsWith(".sh"));
  if (scripts.length === 0) {
    info("no .sh scripts found");
    return;
  }

  for (const script of scripts) {
    const scriptPath = path.join(scriptsDir, script);
    try {
      execSync(`bash "${scriptPath}" --help`, { stdio: "pipe", timeout: 5000 });
      ok(`${script} --help exits 0`);
    } catch (e: any) {
      if (e.status !== 0) {
        fail(`${script} --help exited with code ${e.status}`);
      } else {
        ok(`${script} --help exits 0`);
      }
    }
  }
}

// ── Run all checks ──

console.log("Validating decision-ops skill bundle...");

validateSkillMd();
validateTriggerQueries();
validateEvals();
validateOpenaiYaml();
validateScripts();

console.log("");

if (errors.length > 0) {
  console.error(`FAILED with ${errors.length} error(s):`);
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
} else {
  console.log("All checks passed.");
}
