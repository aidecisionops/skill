import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  SKILL_NAME,
  SKILL_DIR,
  loadPlatforms,
  installSkillToIde,
  installMcpToRepo,
  installManifestToRepo,
  type PlatformDefinition,
  type ManifestContext,
} from "./index";

// ── Helpers ──

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join("/tmp", `${prefix}-`));
}

function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Claude Code expects:
//   ~/.claude/skills/<skill-name>/SKILL.md  (required entry point)
//   ~/.claude/skills/<skill-name>/references/*
//   ~/.claude/skills/<skill-name>/scripts/*
//
// Cursor expects:
//   ~/.cursor/skills/<skill-name>/SKILL.md
//   (same structure)

const EXPECTED_SKILL_FILES = [
  "SKILL.md",
  "references/decision-ops-manifest.md",
  "references/mcp-interface.md",
  "references/decision-register-format.md",
  "scripts/read-manifest.sh",
];

// ────────────────────────────────────────────
// IDE-level install path
// ────────────────────────────────────────────

describe("IDE-level skill install", () => {
  let tmpHome: string;
  let platforms: Record<string, PlatformDefinition>;

  beforeEach(() => {
    tmpHome = makeTmpDir("skill-ide-install");
    platforms = loadPlatforms();
  });

  afterEach(() => {
    removeTmpDir(tmpHome);
  });

  // ── Claude Code ──

  describe("claude-code", () => {
    test("installs SKILL.md and supporting files to ~/.claude/skills/decision-ops", () => {
      const platform = platforms["claude-code"];
      // Override: install to tmp dir by setting env
      const tmpResult = installSkillToIde(
        {
          ...platform,
          skill: {
            ...platform.skill!,
            install_root_default: path.join(tmpHome, ".claude", "skills"),
            install_root_env: undefined,
          },
        },
        { skill_name: SKILL_NAME },
        SKILL_DIR,
      );

      expect(tmpResult.platform).toBe("claude-code");
      expect(tmpResult.path).toContain("decision-ops");
      expect(tmpResult.files.length).toBeGreaterThan(0);

      // Verify expected file structure per Claude Code docs:
      // skill-name/SKILL.md is the required entrypoint
      for (const relFile of EXPECTED_SKILL_FILES) {
        const fullPath = path.join(tmpResult.path, relFile);
        expect(fs.existsSync(fullPath)).toBe(true);
      }
    });

    test("SKILL.md has valid frontmatter with name and description", () => {
      const result = installSkillToIde(
        {
          ...platforms["claude-code"],
          skill: {
            ...platforms["claude-code"].skill!,
            install_root_default: path.join(tmpHome, ".claude", "skills"),
            install_root_env: undefined,
          },
        },
        { skill_name: SKILL_NAME },
        SKILL_DIR,
      );

      const skillMd = fs.readFileSync(path.join(result.path, "SKILL.md"), "utf8");
      expect(skillMd.startsWith("---")).toBe(true);
      expect(skillMd).toContain("name: decision-ops");
      expect(skillMd).toContain("description:");
    });

    test("installed scripts are functional (read-manifest.sh --help)", () => {
      const result = installSkillToIde(
        {
          ...platforms["claude-code"],
          skill: {
            ...platforms["claude-code"].skill!,
            install_root_default: path.join(tmpHome, ".claude", "skills"),
            install_root_env: undefined,
          },
        },
        { skill_name: SKILL_NAME },
        SKILL_DIR,
      );

      const scriptPath = path.join(result.path, "scripts", "read-manifest.sh");
      const output = execSync(`bash "${scriptPath}" --help`, { encoding: "utf8" });
      expect(output).toContain("read-manifest.sh");
    });
  });

  // ── Cursor ──

  describe("cursor", () => {
    test("installs skill to ~/.cursor/skills/decision-ops", () => {
      const result = installSkillToIde(
        {
          ...platforms["cursor"],
          skill: {
            ...platforms["cursor"].skill!,
            install_root_default: path.join(tmpHome, ".cursor", "skills"),
            install_root_env: undefined,
          },
        },
        { skill_name: SKILL_NAME },
        SKILL_DIR,
      );

      expect(result.path).toContain(path.join(".cursor", "skills", "decision-ops"));
      for (const relFile of EXPECTED_SKILL_FILES) {
        expect(fs.existsSync(path.join(result.path, relFile))).toBe(true);
      }
    });
  });

  // ── Codex ──

  describe("codex", () => {
    test("installs skill to ~/.agents/skills/decision-ops", () => {
      const result = installSkillToIde(
        {
          ...platforms["codex"],
          skill: {
            ...platforms["codex"].skill!,
            install_root_default: path.join(tmpHome, ".agents", "skills"),
            install_root_env: undefined,
          },
        },
        { skill_name: SKILL_NAME },
        SKILL_DIR,
      );

      expect(result.path).toContain(path.join(".agents", "skills", "decision-ops"));
      for (const relFile of EXPECTED_SKILL_FILES) {
        expect(fs.existsSync(path.join(result.path, relFile))).toBe(true);
      }
    });
  });

  // ── Antigravity ──

  describe("antigravity", () => {
    test("installs skill to ~/.gemini/config/skills/decision-ops", () => {
      const result = installSkillToIde(
        {
          ...platforms["antigravity"],
          skill: {
            ...platforms["antigravity"].skill!,
            install_root_default: path.join(tmpHome, ".gemini", "config", "skills"),
            install_root_env: undefined,
          },
        },
        { skill_name: SKILL_NAME },
        SKILL_DIR,
      );

      expect(result.path).toContain(path.join(".gemini", "config", "skills", "decision-ops"));
      for (const relFile of EXPECTED_SKILL_FILES) {
        expect(fs.existsSync(path.join(result.path, relFile))).toBe(true);
      }
    });
  });

  describe("vscode", () => {
    test("installs the complete skill into the Copilot personal discovery directory", () => {
      const platform = platforms["vscode"];
      const result = installSkillToIde({...platform,skill:{...platform.skill!,install_root_default:path.join(tmpHome,".copilot","skills"),install_root_env:undefined}}, {skill_name:SKILL_NAME}, SKILL_DIR);
      expect(result.path).toContain(path.join(".copilot","skills","decision-ops"));
      for (const relFile of EXPECTED_SKILL_FILES) expect(fs.existsSync(path.join(result.path,relFile))).toBe(true);
    });
  });

  // ── Env override ──

  describe("env override", () => {
    test("uses env var for install root when set", () => {
      const customDir = path.join(tmpHome, "custom-skills");
      const envKey = "TEST_SKILLS_DIR_" + Date.now();
      process.env[envKey] = customDir;

      try {
        const result = installSkillToIde(
          {
            ...platforms["claude-code"],
            skill: {
              ...platforms["claude-code"].skill!,
              install_root_env: envKey,
              install_root_default: "/should-not-be-used",
            },
          },
          { skill_name: SKILL_NAME },
          SKILL_DIR,
        );

        expect(result.path).toContain(customDir);
        expect(fs.existsSync(path.join(result.path, "SKILL.md"))).toBe(true);
      } finally {
        delete process.env[envKey];
      }
    });
  });
});

// ────────────────────────────────────────────
// Repo-level install path
// ────────────────────────────────────────────

describe("Repo-level install", () => {
  let tmpRepo: string;
  let platforms: Record<string, PlatformDefinition>;

  const MCP_SERVER_NAME = "decision-ops-mcp";
  const MCP_SERVER_URL = "https://api.aidecisionops.com/mcp";

  beforeEach(() => {
    tmpRepo = makeTmpDir("skill-repo-install");
    platforms = loadPlatforms();
  });

  afterEach(() => {
    removeTmpDir(tmpRepo);
  });

  // ── MCP config: Claude Code (.mcp.json) ──

  describe("claude-code MCP config", () => {
    test("creates .mcp.json with mcpServers entry", () => {
      const result = installMcpToRepo(
        {
          ...platforms["claude-code"],
          mcp: {
            ...platforms["claude-code"].mcp!,
            install_path_default: path.join(tmpRepo, ".mcp.json"),
            install_path_env: undefined,
          },
        },
        { repo_path: tmpRepo },
        MCP_SERVER_NAME,
        MCP_SERVER_URL,
      );

      const configPath = path.join(tmpRepo, ".mcp.json");
      expect(fs.existsSync(configPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.mcpServers[MCP_SERVER_NAME]).toBeDefined();
      expect(config.mcpServers[MCP_SERVER_NAME].type).toBe("http");
      expect(config.mcpServers[MCP_SERVER_NAME].url).toBe(MCP_SERVER_URL);
    });

    test("merges into existing .mcp.json without clobbering", () => {
      const configPath = path.join(tmpRepo, ".mcp.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          mcpServers: {
            "existing-server": { type: "stdio", command: "node" },
          },
        }),
      );

      installMcpToRepo(
        {
          ...platforms["claude-code"],
          mcp: {
            ...platforms["claude-code"].mcp!,
            install_path_default: configPath,
            install_path_env: undefined,
          },
        },
        { repo_path: tmpRepo },
        MCP_SERVER_NAME,
        MCP_SERVER_URL,
      );

      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.mcpServers["existing-server"]).toBeDefined();
      expect(config.mcpServers[MCP_SERVER_NAME]).toBeDefined();
    });
  });

  // ── MCP config: Cursor (.cursor/mcp.json) ──

  describe("cursor MCP config", () => {
    test("creates .cursor/mcp.json with mcpServers entry", () => {
      const configPath = path.join(tmpRepo, ".cursor", "mcp.json");

      installMcpToRepo(
        {
          ...platforms["cursor"],
          mcp: {
            ...platforms["cursor"].mcp!,
            install_path_default: configPath,
            install_path_env: undefined,
          },
        },
        { repo_path: tmpRepo },
        MCP_SERVER_NAME,
        MCP_SERVER_URL,
      );

      expect(fs.existsSync(configPath)).toBe(true);
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.mcpServers[MCP_SERVER_NAME].type).toBe("http");
      expect(config.mcpServers[MCP_SERVER_NAME].url).toBe(MCP_SERVER_URL);
    });
  });

  // ── MCP config: VS Code (.vscode/mcp.json) ──

  describe("vscode MCP config", () => {
    test("creates .vscode/mcp.json with servers key (not mcpServers)", () => {
      const configPath = path.join(tmpRepo, ".vscode", "mcp.json");

      installMcpToRepo(
        {
          ...platforms["vscode"],
          mcp: {
            ...platforms["vscode"].mcp!,
            install_path_default: configPath,
            install_path_env: undefined,
          },
        },
        { repo_path: tmpRepo },
        MCP_SERVER_NAME,
        MCP_SERVER_URL,
      );

      expect(fs.existsSync(configPath)).toBe(true);
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      // VS Code uses "servers" as root key, not "mcpServers"
      expect(config.servers[MCP_SERVER_NAME].type).toBe("http");
      expect(config.servers[MCP_SERVER_NAME].url).toBe(MCP_SERVER_URL);
    });
  });

  // ── MCP config: Codex (config.toml) ──

  describe("codex MCP config", () => {
    test("appends mcp_servers section to config.toml", () => {
      const codexHome = path.join(tmpRepo, ".codex");
      const configPath = path.join(codexHome, "config.toml");
      fs.mkdirSync(codexHome, { recursive: true });

      installMcpToRepo(
        {
          ...platforms["codex"],
          mcp: {
            ...platforms["codex"].mcp!,
            install_root_default: codexHome,
            install_root_env: undefined,
            install_path_env: undefined,
          },
        },
        {},
        MCP_SERVER_NAME,
        MCP_SERVER_URL,
      );

      expect(fs.existsSync(configPath)).toBe(true);
      const content = fs.readFileSync(configPath, "utf8");
      expect(content).toContain(`[mcp_servers.${MCP_SERVER_NAME}]`);
      expect(content).toContain(`url = "${MCP_SERVER_URL}"`);
      expect(content).toContain(`type = "http"`);
      expect(content).toContain("enabled = true");
    });

    test("does not duplicate codex section on re-install", () => {
      const codexHome = path.join(tmpRepo, ".codex");
      const configPath = path.join(codexHome, "config.toml");
      fs.mkdirSync(codexHome, { recursive: true });

      const platformOverride = {
        ...platforms["codex"],
        mcp: {
          ...platforms["codex"].mcp!,
          install_root_default: codexHome,
          install_root_env: undefined,
          install_path_env: undefined,
        },
      };

      installMcpToRepo(platformOverride, {}, MCP_SERVER_NAME, MCP_SERVER_URL);
      installMcpToRepo(platformOverride, {}, MCP_SERVER_NAME, MCP_SERVER_URL);

      const content = fs.readFileSync(configPath, "utf8");
      const matches = content.match(/\[mcp_servers\.decision-ops-mcp\]/g);
      expect(matches?.length).toBe(1);
    });
  });

  // ── Manifest install ──

  describe("manifest install", () => {
    const MANIFEST: ManifestContext = {
      org_id: "org_test_123",
      project_id: "proj_test_456",
      repo_ref: "github.com/test/repo",
      default_branch: "main",
      mcp_server_name: "decision-ops-mcp",
      mcp_server_url: "https://api.aidecisionops.com/mcp",
    };

    test("creates .decisionops/manifest.toml with required fields", () => {
      const result = installManifestToRepo(tmpRepo, MANIFEST);

      const manifestPath = path.join(tmpRepo, ".decisionops", "manifest.toml");
      expect(fs.existsSync(manifestPath)).toBe(true);
      expect(result.path).toBe(manifestPath);

      const content = fs.readFileSync(manifestPath, "utf8");
      expect(content).toContain(`org_id = "${MANIFEST.org_id}"`);
      expect(content).toContain(`project_id = "${MANIFEST.project_id}"`);
      expect(content).toContain(`repo_ref = "${MANIFEST.repo_ref}"`);
    });

    test("includes optional fields when provided", () => {
      installManifestToRepo(tmpRepo, MANIFEST);

      const content = fs.readFileSync(
        path.join(tmpRepo, ".decisionops", "manifest.toml"),
        "utf8",
      );
      expect(content).toContain(`default_branch = "${MANIFEST.default_branch}"`);
      expect(content).toContain(`mcp_server_name = "${MANIFEST.mcp_server_name}"`);
      expect(content).toContain(`mcp_server_url = "${MANIFEST.mcp_server_url}"`);
    });

    test("omits optional fields when not provided", () => {
      installManifestToRepo(tmpRepo, {
        org_id: "org_1",
        project_id: "proj_1",
        repo_ref: "ref",
      });

      const content = fs.readFileSync(
        path.join(tmpRepo, ".decisionops", "manifest.toml"),
        "utf8",
      );
      expect(content).not.toContain("default_branch");
      expect(content).not.toContain("mcp_server_name");
      expect(content).not.toContain("mcp_server_url");
    });

    test("manifest is parseable by read-manifest.sh", () => {
      installManifestToRepo(tmpRepo, MANIFEST);

      const scriptPath = path.join(SKILL_DIR, "scripts", "read-manifest.sh");
      const output = execSync(`bash "${scriptPath}" "${tmpRepo}"`, { encoding: "utf8" });
      const parsed = JSON.parse(output);

      expect(parsed.org_id).toBe(MANIFEST.org_id);
      expect(parsed.project_id).toBe(MANIFEST.project_id);
      expect(parsed.repo_ref).toBe(MANIFEST.repo_ref);
      expect(parsed.default_branch).toBe(MANIFEST.default_branch);
    });
  });
});

// ────────────────────────────────────────────
// Combined install (both paths together)
// ────────────────────────────────────────────

describe("Combined IDE + Repo install", () => {
  let tmpHome: string;
  let tmpRepo: string;
  let platforms: Record<string, PlatformDefinition>;

  const MCP_SERVER_NAME = "decision-ops-mcp";
  const MCP_SERVER_URL = "https://api.aidecisionops.com/mcp";
  const MANIFEST: ManifestContext = {
    org_id: "org_combo",
    project_id: "proj_combo",
    repo_ref: "github.com/combo/repo",
    default_branch: "main",
    mcp_server_name: MCP_SERVER_NAME,
    mcp_server_url: MCP_SERVER_URL,
  };

  beforeEach(() => {
    tmpHome = makeTmpDir("skill-combo-home");
    tmpRepo = makeTmpDir("skill-combo-repo");
    platforms = loadPlatforms();
  });

  afterEach(() => {
    removeTmpDir(tmpHome);
    removeTmpDir(tmpRepo);
  });

  test("claude-code: full install produces working skill + MCP + manifest", () => {
    const platform = platforms["claude-code"];

    // IDE install
    const skillResult = installSkillToIde(
      {
        ...platform,
        skill: {
          ...platform.skill!,
          install_root_default: path.join(tmpHome, ".claude", "skills"),
          install_root_env: undefined,
        },
      },
      { skill_name: SKILL_NAME },
      SKILL_DIR,
    );

    // Repo MCP install
    const mcpResult = installMcpToRepo(
      {
        ...platform,
        mcp: {
          ...platform.mcp!,
          install_path_default: path.join(tmpRepo, ".mcp.json"),
          install_path_env: undefined,
        },
      },
      { repo_path: tmpRepo },
      MCP_SERVER_NAME,
      MCP_SERVER_URL,
    );

    // Repo manifest install
    const manifestResult = installManifestToRepo(tmpRepo, MANIFEST);

    // Verify skill directory structure
    expect(fs.existsSync(path.join(skillResult.path, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillResult.path, "references", "mcp-interface.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillResult.path, "scripts", "read-manifest.sh"))).toBe(true);

    // Verify MCP config
    const mcpConfig = JSON.parse(fs.readFileSync(mcpResult.path, "utf8"));
    expect(mcpConfig.mcpServers[MCP_SERVER_NAME].url).toBe(MCP_SERVER_URL);

    // Verify manifest is readable
    const scriptPath = path.join(skillResult.path, "scripts", "read-manifest.sh");
    const manifestJson = JSON.parse(
      execSync(`bash "${scriptPath}" "${tmpRepo}"`, { encoding: "utf8" }),
    );
    expect(manifestJson.org_id).toBe(MANIFEST.org_id);
    expect(manifestJson.project_id).toBe(MANIFEST.project_id);
  });

  test("cursor: full install produces working skill + MCP + manifest", () => {
    const platform = platforms["cursor"];

    const skillResult = installSkillToIde(
      {
        ...platform,
        skill: {
          ...platform.skill!,
          install_root_default: path.join(tmpHome, ".cursor", "skills"),
          install_root_env: undefined,
        },
      },
      { skill_name: SKILL_NAME },
      SKILL_DIR,
    );

    const mcpConfigPath = path.join(tmpRepo, ".cursor", "mcp.json");
    installMcpToRepo(
      {
        ...platform,
        mcp: {
          ...platform.mcp!,
          install_path_default: mcpConfigPath,
          install_path_env: undefined,
        },
      },
      { repo_path: tmpRepo },
      MCP_SERVER_NAME,
      MCP_SERVER_URL,
    );

    installManifestToRepo(tmpRepo, MANIFEST);

    // Verify Cursor-specific paths
    expect(skillResult.path).toContain(path.join(".cursor", "skills", "decision-ops"));
    expect(fs.existsSync(mcpConfigPath)).toBe(true);

    const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, "utf8"));
    expect(mcpConfig.mcpServers[MCP_SERVER_NAME]).toBeDefined();
  });
});
