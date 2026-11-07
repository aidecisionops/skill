import { describe, test, expect, beforeAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  SKILL_NAME,
  SKILL_DIR,
  PLATFORMS_DIR,
  DEFAULT_PLATFORM_CATALOG_PATH,
  DEFAULT_MCP_SERVER_NAME,
  DEFAULT_MCP_SERVER_URL,
  loadPlatforms,
  selectPlatforms,
  expandHome,
  expandPath,
  formatTemplate,
  resolveInstallPath,
  authInstructions,
  buildPlatformCatalog,
  writePlatformCatalog,
  type PlatformDefinition,
  type PlatformInstallSpec,
} from "./index";

// ── Constants ──

describe("constants", () => {
  test("SKILL_NAME is decision-ops", () => {
    expect(SKILL_NAME).toBe("decision-ops");
  });

  test("SKILL_DIR points to decision-ops directory", () => {
    expect(SKILL_DIR).toContain("decision-ops");
    expect(fs.existsSync(SKILL_DIR)).toBe(true);
  });

  test("PLATFORMS_DIR points to platforms directory", () => {
    expect(PLATFORMS_DIR).toContain("platforms");
    expect(fs.existsSync(PLATFORMS_DIR)).toBe(true);
  });
});

// ── expandHome ──

describe("expandHome", () => {
  test("expands ~ to HOME", () => {
    const home = process.env.HOME!;
    expect(expandHome("~/foo")).toBe(path.join(home, "foo"));
  });

  test("expands bare ~", () => {
    const home = process.env.HOME!;
    expect(expandHome("~")).toBe(home);
  });

  test("leaves absolute paths unchanged", () => {
    expect(expandHome("/usr/local/bin")).toBe("/usr/local/bin");
  });

  test("leaves relative paths unchanged", () => {
    expect(expandHome("relative/path")).toBe("relative/path");
  });

  test("does not expand ~user style paths", () => {
    expect(expandHome("~other/foo")).toBe("~other/foo");
  });
});

// ── formatTemplate ──

describe("formatTemplate", () => {
  test("replaces single variable", () => {
    expect(formatTemplate("hello {name}", { name: "world" })).toBe("hello world");
  });

  test("replaces multiple variables", () => {
    expect(formatTemplate("{a}/{b}", { a: "x", b: "y" })).toBe("x/y");
  });

  test("throws on missing variable", () => {
    expect(() => formatTemplate("{missing}", {})).toThrow("Missing template variable");
  });

  test("returns string unchanged when no placeholders", () => {
    expect(formatTemplate("no-vars", {})).toBe("no-vars");
  });
});

// ── expandPath ──

describe("expandPath", () => {
  test("expands both ~ and template vars", () => {
    const home = process.env.HOME!;
    const result = expandPath("~/{dir}/sub", { dir: "test" });
    expect(result).toBe(path.join(home, "test/sub"));
  });
});

// ── loadPlatforms ──

describe("loadPlatforms", () => {
  let platforms: Record<string, PlatformDefinition>;

  beforeAll(() => {
    platforms = loadPlatforms();
  });

  test("loads at least one platform", () => {
    expect(Object.keys(platforms).length).toBeGreaterThan(0);
  });

  test("loads claude-code platform", () => {
    expect(platforms["claude-code"]).toBeDefined();
    expect(platforms["claude-code"].id).toBe("claude-code");
    expect(platforms["claude-code"].display_name).toBeDefined();
  });

  test("loads cursor platform", () => {
    expect(platforms["cursor"]).toBeDefined();
  });

  test("loads codex platform", () => {
    expect(platforms["codex"]).toBeDefined();
  });

  test("each platform has __file__ metadata", () => {
    for (const p of Object.values(platforms)) {
      expect(p.__file__).toContain(".toml");
    }
  });

  test("throws on non-existent directory", () => {
    expect(() => loadPlatforms("/nonexistent")).toThrow();
  });
});

// ── selectPlatforms ──

describe("selectPlatforms", () => {
  let platforms: Record<string, PlatformDefinition>;

  beforeAll(() => {
    platforms = loadPlatforms();
  });

  test("returns all platforms when no filter", () => {
    const selected = selectPlatforms(platforms);
    expect(selected.length).toBe(Object.keys(platforms).length);
  });

  test("filters by specific IDs", () => {
    const selected = selectPlatforms(platforms, ["claude-code", "cursor"]);
    expect(selected.length).toBe(2);
    expect(selected.map((p) => p.id)).toEqual(["claude-code", "cursor"]);
  });

  test("filters by skill capability", () => {
    const selected = selectPlatforms(platforms, undefined, "skill");
    for (const p of selected) {
      expect(p.skill?.supported).toBe(true);
    }
  });

  test("filters by mcp capability", () => {
    const selected = selectPlatforms(platforms, undefined, "mcp");
    for (const p of selected) {
      expect(p.mcp?.supported).toBe(true);
    }
  });

  test("throws on unknown platform ID", () => {
    expect(() => selectPlatforms(platforms, ["nonexistent"])).toThrow("Unknown platform");
  });
});

// ── resolveInstallPath ──

describe("resolveInstallPath", () => {
  test("uses install_path_default with expansion", () => {
    const spec: PlatformInstallSpec = {
      supported: true,
      install_path_default: "~/.claude/skills/decision-ops",
    };
    const result = resolveInstallPath(spec, {});
    expect(result).toContain("skills/decision-ops");
  });

  test("returns null when repo_path needed but missing", () => {
    const spec: PlatformInstallSpec = {
      supported: true,
      install_path_default: "{repo_path}/.config",
    };
    const result = resolveInstallPath(spec, {});
    expect(result).toBeNull();
  });

  test("uses install_root_default with suffix", () => {
    const spec: PlatformInstallSpec = {
      supported: true,
      install_root_default: "~/.codex",
      install_path_suffix: "skills/{skill_name}",
    };
    const result = resolveInstallPath(spec, { skill_name: "decision-ops" });
    expect(result).toContain("skills/decision-ops");
  });

  test("returns null for empty spec", () => {
    const result = resolveInstallPath({}, {});
    expect(result).toBeNull();
  });
});

// ── authInstructions ──

describe("authInstructions", () => {
  test("returns null for non-browser_oauth mode", () => {
    const platform: PlatformDefinition = {
      id: "test",
      display_name: "Test",
      auth: { mode: "api_key" },
      __file__: "test.toml",
    };
    expect(authInstructions(platform, {})).toBeNull();
  });

  test("returns instructions for browser_oauth", () => {
    const platform: PlatformDefinition = {
      id: "test",
      display_name: "Test",
      auth: {
        mode: "browser_oauth",
        instructions: ["Step 1: {action}", "Step 2: done"],
      },
      __file__: "test.toml",
    };
    const result = authInstructions(platform, { action: "verify" });
    expect(result).toEqual(["Step 1: verify", "Step 2: done"]);
  });

  test("returns null when no auth", () => {
    const platform: PlatformDefinition = {
      id: "test",
      display_name: "Test",
      __file__: "test.toml",
    };
    expect(authInstructions(platform, {})).toBeNull();
  });
});

// ── platform catalog ──

describe("platform catalog", () => {
  test("checked-in catalog matches platform definitions", () => {
    const expected = `${JSON.stringify(buildPlatformCatalog(), null, 2)}\n`;
    expect(fs.readFileSync(DEFAULT_PLATFORM_CATALOG_PATH, "utf8")).toBe(expected);
  });

  test("buildPlatformCatalog returns sorted combined platform metadata", () => {
    const catalog = buildPlatformCatalog();

    expect(catalog.version).toBe(1);
    expect(catalog.defaults.skill_name).toBe(SKILL_NAME);
    expect(catalog.defaults.mcp_server_name).toBe(DEFAULT_MCP_SERVER_NAME);
    expect(catalog.defaults.mcp_server_url).toBe(DEFAULT_MCP_SERVER_URL);
    expect(catalog.platforms.length).toBeGreaterThan(0);
    expect(catalog.platforms.map((platform) => platform.id)).toEqual(
      [...catalog.platforms.map((platform) => platform.id)].sort(),
    );

    const codex = catalog.platforms.find((platform) => platform.id === "codex");
    expect(codex).toBeDefined();
    expect(codex?.platform_definition).toBe("platforms/codex.toml");
    expect(codex?.skill.supported).toBe(true);
    expect(codex?.skill.install_path_template).toBe("~/.codex/skills/{skill_name}");
    expect(codex?.mcp.config_path_template).toBe("~/.codex/config.toml");
    expect(codex?.auth.mode).toBe("browser_oauth");
    expect(codex?.auth.instructions.length).toBeGreaterThan(0);
    expect(codex?.cli_install_template).toContain("dops install codex");

    const vscode = catalog.platforms.find((platform) => platform.id === "vscode");
    expect(vscode?.skill.supported).toBe(false);
    expect(vscode?.skill.install_path_template).toBeNull();
    expect(vscode?.mcp.root_key).toBe("servers");
  });

  test("writePlatformCatalog writes JSON to disk", () => {
    const tmpDir = fs.mkdtempSync(path.join("/tmp", "platform-catalog-"));

    try {
      const outputPath = path.join(tmpDir, "platform-catalog.json");
      const writtenPath = writePlatformCatalog(outputPath);

      expect(writtenPath).toBe(outputPath);
      expect(DEFAULT_PLATFORM_CATALOG_PATH).toContain("platform-catalog.json");

      const written = JSON.parse(fs.readFileSync(outputPath, "utf8"));
      expect(written.version).toBe(1);
      expect(Array.isArray(written.platforms)).toBe(true);
      expect(written.platforms.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Skill bundle structure ──

describe("skill bundle structure", () => {
  test("SKILL.md exists and has frontmatter", () => {
    const content = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
    expect(content.startsWith("---")).toBe(true);
    expect(content).toContain("name: decision-ops");
  });

  test("SKILL.md mandates in-agent decision analysis, plain language, obvious chosen option, and complete logged decision summary in response", () => {
    const content = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
    expect(content).toContain('prompt_version: "2.2.0"');
    expect(content).toContain("Plain, Simple English (Zero Jargon)");
    expect(content).toContain("Make the Chosen / Recommended Option Unmistakable");
    expect(content).toContain("Differentiated Depth (`Quick` vs `Comprehensive`)");
    expect(content).toContain("Mandatory: Render a Clear, Plain-English Decision Summary in Your Response");
    expect(content).toContain("### Decision Logged in DecisionOps");
    expect(content).toContain("✅ Chosen / Recommended Option: Option 1");
    expect(content).toContain("#### Why This Decision Is Needed (Context)");
    expect(content).toContain("#### What We're Doing & What We're Skipping (Decision & Boundaries)");
    expect(content).toContain("#### Option Comparison Matrix (Mandatory in Comprehensive Mode — Must Be a Markdown Table)");
    expect(content).toContain("#### Options Considered (Pros, Cons & Why Chosen / Rejected)");
    expect(content).toContain("#### Tradeoffs & What Could Go Wrong (Consequences)");
    expect(content).toContain("#### How We'll Measure Success (Validation Plan)");
  });

  test("trigger-queries.json has 10+ positive and 10+ negative", () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(SKILL_DIR, "evals", "trigger-queries.json"), "utf8"),
    );
    expect(data.positive.length).toBeGreaterThanOrEqual(10);
    expect(data.negative.length).toBeGreaterThanOrEqual(10);
  });

  test("evals.json has version 1 and 2+ cases", () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(SKILL_DIR, "evals", "evals.json"), "utf8"),
    );
    expect(data.version).toBe(1);
    expect(data.cases.length).toBeGreaterThanOrEqual(2);
  });

  test("each eval case has expected_behavior and rubric", () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(SKILL_DIR, "evals", "evals.json"), "utf8"),
    );
    for (const c of data.cases) {
      expect(c.id).toBeDefined();
      expect(c.expected_behavior.length).toBeGreaterThan(0);
      expect(c.rubric.length).toBeGreaterThan(0);
    }
  });

  test("each trigger query entry has id, prompt, why", () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(SKILL_DIR, "evals", "trigger-queries.json"), "utf8"),
    );
    for (const entry of [...data.positive, ...data.negative]) {
      expect(entry.id).toBeDefined();
      expect(entry.prompt).toBeDefined();
      expect(entry.why).toBeDefined();
    }
  });

  test("openai.yaml references $decision-ops", () => {
    const content = fs.readFileSync(path.join(SKILL_DIR, "agents", "openai.yaml"), "utf8");
    expect(content).toContain("$decision-ops");
  });

  test("read-manifest.sh is executable-compatible", () => {
    const content = fs.readFileSync(
      path.join(SKILL_DIR, "scripts", "read-manifest.sh"),
      "utf8",
    );
    expect(content.startsWith("#!/usr/bin/env bash")).toBe(true);
  });
});
