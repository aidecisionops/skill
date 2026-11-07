import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as TOML from "@iarna/toml";

const MODULE_DIR = import.meta.dir ?? (import.meta as { dirname?: string }).dirname ?? path.dirname(fileURLToPath(import.meta.url));

export const SKILL_NAME = "decision-ops";
export const ROOT_DIR = path.join(MODULE_DIR, "..");
export const SKILL_DIR = path.join(MODULE_DIR, "..", "decision-ops");
export const PLATFORMS_DIR = path.join(MODULE_DIR, "..", "platforms");
export const DEFAULT_MCP_SERVER_NAME = "decision-ops-mcp";
export const DEFAULT_MCP_SERVER_URL = "https://api.aidecisionops.com/mcp";
export const DEFAULT_PLATFORM_CATALOG_PATH = path.join(PLATFORMS_DIR, "platform-catalog.json");

export type PlatformInstallSpec = {
  supported?: boolean;
  build_path?: string;
  install_path_env?: string;
  install_path_default?: string;
  install_root_env?: string;
  install_root_default?: string;
  install_path_suffix?: string;
  scope?: "user" | "project";
  format?: "codex_toml" | "json_map";
  root_key?: string;
};

export type AuthTriggerKind = "cli" | "slash" | "palette" | "manual";
export type AuthTriggerReason = "primary" | "reset";

export type AuthTrigger = {
  kind: AuthTriggerKind;
  reason?: AuthTriggerReason;
  label?: string;
  hint?: string;
  command?: string[];
};

export type PlatformAuthSpec = {
  mode?: string;
  instructions?: string[];
  triggers?: AuthTrigger[];
};

export type PlatformDefinition = {
  id: string;
  display_name: string;
  skill?: PlatformInstallSpec;
  mcp?: PlatformInstallSpec;
  manifest?: PlatformInstallSpec;
  auth?: PlatformAuthSpec;
  __file__: string;
};

export type PlatformCatalogEntry = {
  id: string;
  display_name: string;
  platform_definition: string;
  skill: {
    supported: boolean;
    install_path_template: string | null;
    install_path_env: string | null;
  };
  mcp: {
    supported: boolean;
    scope: "user" | "project" | null;
    config_path_template: string | null;
    config_path_env: string | null;
    format: "codex_toml" | "json_map" | null;
    root_key: string | null;
  };
  manifest: {
    supported: boolean;
    path_template: string | null;
  };
  auth: {
    mode: string | null;
    instructions: string[];
    triggers: AuthTrigger[];
  };
  default_server: {
    name: string;
    url: string;
  };
  cli_install_template: string;
};

export type PlatformCatalog = {
  version: 1;
  defaults: {
    skill_name: string;
    mcp_server_name: string;
    mcp_server_url: string;
  };
  platforms: PlatformCatalogEntry[];
};

export function loadPlatforms(platformsDir = PLATFORMS_DIR): Record<string, PlatformDefinition> {
  const platforms: Record<string, PlatformDefinition> = {};
  for (const entry of fs.readdirSync(platformsDir)) {
    if (!entry.endsWith(".toml")) continue;
    const filePath = path.join(platformsDir, entry);
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = TOML.parse(raw) as Omit<PlatformDefinition, "__file__">;
    if (!parsed.id) throw new Error(`Platform file missing id: ${filePath}`);
    if (parsed.id !== path.basename(entry, ".toml")) {
      throw new Error(`Platform id '${parsed.id}' must match filename '${path.basename(entry, ".toml")}': ${filePath}`);
    }
    platforms[parsed.id] = { ...parsed, __file__: filePath };
  }
  if (Object.keys(platforms).length === 0) {
    throw new Error(`No platform definitions found in ${platformsDir}`);
  }
  return platforms;
}

export function selectPlatforms(
  platforms: Record<string, PlatformDefinition>,
  selectedIds?: string[],
  capability?: "skill" | "mcp" | "manifest",
): PlatformDefinition[] {
  const orderedIds = selectedIds && selectedIds.length > 0 ? selectedIds : Object.keys(platforms);
  const missing = orderedIds.filter((id) => !platforms[id]);
  if (missing.length > 0) throw new Error(`Unknown platform(s): ${missing.join(", ")}`);
  return orderedIds
    .map((id) => platforms[id])
    .filter((p) => !capability || Boolean(p[capability]?.supported));
}

export function expandHome(input: string): string {
  if (!input.startsWith("~")) return input;
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return input;
  if (input === "~") return home;
  if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(home, input.slice(2));
  return input;
}

export function formatTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (match, key: string) => {
    if (!(key in context)) throw new Error(`Missing template variable '${key}' in value: ${template}`);
    return context[key] ?? match;
  });
}

export function expandPath(value: string, context: Record<string, string>): string {
  return expandHome(formatTemplate(value, context));
}

export function resolveInstallPath(spec: PlatformInstallSpec, context: Record<string, string>): string | null {
  if (spec.install_path_env && process.env[spec.install_path_env]) {
    return path.resolve(expandPath(process.env[spec.install_path_env]!, context));
  }
  if (spec.install_root_env || spec.install_root_default) {
    const rootValue = spec.install_root_env ? process.env[spec.install_root_env] || spec.install_root_default : spec.install_root_default;
    if (!rootValue) return null;
    const rootPath = path.resolve(expandPath(rootValue, context));
    return path.join(rootPath, formatTemplate(spec.install_path_suffix ?? "", context));
  }
  if (spec.install_path_default) {
    if (!context.repo_path && spec.install_path_default.includes("{repo_path}")) return null;
    return path.resolve(expandPath(spec.install_path_default, context));
  }
  return null;
}

export function authInstructions(platform: PlatformDefinition, context: Record<string, string>): string[] | null {
  if (platform.auth?.mode !== "browser_oauth") return null;
  return (platform.auth.instructions ?? []).map((step) => formatTemplate(step, context));
}

export function authTriggers(platform: PlatformDefinition, context: Record<string, string>): AuthTrigger[] {
  // Render templates inside trigger fields so consumers get usable values.
  return (platform.auth?.triggers ?? []).map((trigger) => ({
    kind: trigger.kind,
    reason: trigger.reason ?? "primary",
    label: trigger.label ? formatTemplate(trigger.label, context) : undefined,
    hint: trigger.hint ? formatTemplate(trigger.hint, context) : undefined,
    command: trigger.command ? trigger.command.map((part) => formatTemplate(part, context)) : undefined,
  }));
}

function normalizePathForCatalog(filePath: string): string {
  return path.relative(ROOT_DIR, filePath).split(path.sep).join("/");
}

function joinTemplatePath(root: string, suffix?: string): string {
  if (!suffix) return root;
  const cleanedRoot = root.replace(/[\\/]+$/, "");
  const cleanedSuffix = suffix.replace(/^[\\/]+/, "");
  return `${cleanedRoot}/${cleanedSuffix}`;
}

function installPathTemplate(spec?: PlatformInstallSpec): string | null {
  if (!spec) return null;
  if (spec.install_path_default) return spec.install_path_default;
  if (spec.install_root_default) return joinTemplatePath(spec.install_root_default, spec.install_path_suffix);
  if (spec.install_path_env) return `{${spec.install_path_env}}`;
  return null;
}

function cliInstallTemplate(platformId: string): string {
  return `dops install ${platformId} --repo-path {repo_path} --org-id {org_id} --project-id {project_id} --repo-ref {repo_ref}`;
}

function platformToCatalogEntry(platform: PlatformDefinition): PlatformCatalogEntry {
  const skillSupported = Boolean(platform.skill?.supported);
  const mcpSupported = Boolean(platform.mcp?.supported);
  const manifestSupported = Boolean(platform.manifest?.supported);
  const skillPathTemplate = skillSupported ? installPathTemplate(platform.skill) : null;
  const mcpPathTemplate = mcpSupported ? installPathTemplate(platform.mcp) : null;
  const manifestPathTemplate = manifestSupported ? platform.manifest?.build_path ?? ".decisionops/manifest.toml" : null;

  const authContext = {
    skill_name: SKILL_NAME,
    repo_path: "{repo_path}",
    platform_id: platform.id,
    display_name: platform.display_name,
    mcp_server_name: DEFAULT_MCP_SERVER_NAME,
    mcp_server_url: DEFAULT_MCP_SERVER_URL,
    mcp_config_path: mcpPathTemplate ?? "",
  };

  return {
    id: platform.id,
    display_name: platform.display_name,
    platform_definition: normalizePathForCatalog(platform.__file__),
    skill: {
      supported: skillSupported,
      install_path_template: skillPathTemplate,
      install_path_env: platform.skill?.install_path_env ?? null,
    },
    mcp: {
      supported: mcpSupported,
      scope: platform.mcp?.scope ?? null,
      config_path_template: mcpPathTemplate,
      config_path_env: platform.mcp?.install_path_env ?? null,
      format: platform.mcp?.format ?? null,
      root_key: platform.mcp?.root_key ?? null,
    },
    manifest: {
      supported: manifestSupported,
      path_template: manifestPathTemplate,
    },
    auth: {
      mode: platform.auth?.mode ?? null,
      instructions: authInstructions(platform, authContext) ?? [],
      triggers: authTriggers(platform, authContext),
    },
    default_server: {
      name: DEFAULT_MCP_SERVER_NAME,
      url: DEFAULT_MCP_SERVER_URL,
    },
    cli_install_template: cliInstallTemplate(platform.id),
  };
}

export function buildPlatformCatalog(platformsDir = PLATFORMS_DIR): PlatformCatalog {
  const platforms = Object.values(loadPlatforms(platformsDir)).sort((a, b) => a.id.localeCompare(b.id));

  return {
    version: 1,
    defaults: {
      skill_name: SKILL_NAME,
      mcp_server_name: DEFAULT_MCP_SERVER_NAME,
      mcp_server_url: DEFAULT_MCP_SERVER_URL,
    },
    platforms: platforms.map(platformToCatalogEntry),
  };
}

export function writePlatformCatalog(outputPath = DEFAULT_PLATFORM_CATALOG_PATH, platformsDir = PLATFORMS_DIR): string {
  const catalog = buildPlatformCatalog(platformsDir);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  return outputPath;
}

// ── Install types ──

export type InstallResult = {
  platform: string;
  path: string;
  files: string[];
};

export type McpServerEntry = {
  type: string;
  url: string;
  headers?: Record<string, string>;
};

export type ManifestContext = {
  org_id: string;
  project_id: string;
  repo_ref: string;
  default_branch?: string;
  mcp_server_name?: string;
  mcp_server_url?: string;
  repo_id?: string;
};

// ── IDE-level install ──

const SKILL_BUNDLE_DIRS = ["references", "scripts", "evals"];
const SKILL_BUNDLE_FILES = ["SKILL.md"];

function copyDirRecursive(src: string, dest: string): string[] {
  const copied: string[] = [];
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copied.push(...copyDirRecursive(srcPath, destPath));
    } else {
      fs.copyFileSync(srcPath, destPath);
      copied.push(destPath);
    }
  }
  return copied;
}

export function installSkillToIde(
  platform: PlatformDefinition,
  context: Record<string, string>,
  skillDir = SKILL_DIR,
): InstallResult {
  if (!platform.skill?.supported) {
    throw new Error(`Platform '${platform.id}' does not support skill installation`);
  }

  const installPath = resolveInstallPath(platform.skill, {
    ...context,
    skill_name: SKILL_NAME,
  });
  if (!installPath) {
    throw new Error(`Cannot resolve skill install path for platform '${platform.id}'`);
  }

  fs.mkdirSync(installPath, { recursive: true });

  const copiedFiles: string[] = [];

  for (const file of SKILL_BUNDLE_FILES) {
    const src = path.join(skillDir, file);
    const dest = path.join(installPath, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      copiedFiles.push(dest);
    }
  }

  for (const dir of SKILL_BUNDLE_DIRS) {
    const src = path.join(skillDir, dir);
    if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
      copiedFiles.push(...copyDirRecursive(src, path.join(installPath, dir)));
    }
  }

  return { platform: platform.id, path: installPath, files: copiedFiles };
}

// ── Repo-level install ──

export function installMcpToRepo(
  platform: PlatformDefinition,
  context: Record<string, string>,
  serverName: string,
  serverUrl: string,
): InstallResult {
  if (!platform.mcp?.supported) {
    throw new Error(`Platform '${platform.id}' does not support MCP configuration`);
  }

  const configPath = resolveInstallPath(platform.mcp, context);
  if (!configPath) {
    throw new Error(`Cannot resolve MCP config path for platform '${platform.id}'`);
  }

  const configDir = path.dirname(configPath);
  fs.mkdirSync(configDir, { recursive: true });

  if (platform.mcp.format === "json_map") {
    const rootKey = platform.mcp.root_key ?? "mcpServers";
    let existing: Record<string, any> = {};
    if (fs.existsSync(configPath)) {
      existing = JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
    if (!existing[rootKey]) {
      existing[rootKey] = {};
    }
    existing[rootKey][serverName] = {
      type: "http",
      url: serverUrl,
    } satisfies McpServerEntry;
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n");
  } else if (platform.mcp.format === "codex_toml") {
    let content = "";
    if (fs.existsSync(configPath)) {
      content = fs.readFileSync(configPath, "utf8");
    }
    if (!content.includes(`[mcp_servers.${serverName}]`)) {
      content +=
        `\n[mcp_servers.${serverName}]\n` +
        `type = "http"\n` +
        `enabled = true\n` +
        `url = "${serverUrl}"\n`;
      fs.writeFileSync(configPath, content);
    }
  } else {
    throw new Error(`Unsupported MCP format '${platform.mcp.format}' for platform '${platform.id}'`);
  }

  return { platform: platform.id, path: configPath, files: [configPath] };
}

export function installManifestToRepo(
  repoPath: string,
  manifest: ManifestContext,
): InstallResult {
  const manifestDir = path.join(repoPath, ".decisionops");
  const manifestPath = path.join(manifestDir, "manifest.toml");

  fs.mkdirSync(manifestDir, { recursive: true });

  const data: Record<string, unknown> = {
    version: 1,
    org_id: manifest.org_id,
    project_id: manifest.project_id,
    repo_ref: manifest.repo_ref,
  };
  if (manifest.repo_id) data.repo_id = manifest.repo_id;
  if (manifest.default_branch) data.default_branch = manifest.default_branch;
  if (manifest.mcp_server_name) data.mcp_server_name = manifest.mcp_server_name;
  if (manifest.mcp_server_url) data.mcp_server_url = manifest.mcp_server_url;

  fs.writeFileSync(manifestPath, TOML.stringify(data as any), "utf8");

  return { platform: "repo", path: manifestPath, files: [manifestPath] };
}
