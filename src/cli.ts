#!/usr/bin/env bun
import {
  SKILL_NAME,
  SKILL_DIR,
  loadPlatforms,
  selectPlatforms,
  installSkillToIde,
  installMcpToRepo,
  installManifestToRepo,
  resolveInstallPath,
  authInstructions,
  type ManifestContext,
} from "./index";

const HELP = `
Usage: decision-ops-skill <command> [options]

Commands:
  install ide <platform>       Install skill files to IDE skill directory
  install repo <platform>      Install MCP config + manifest to a repository
  install all <platform>       Install both IDE skill and repo config
  platforms                    List available platforms and capabilities
  paths <platform>             Show resolved install paths for a platform
  uninstall ide <platform>     Remove skill files from IDE directory
  uninstall repo <platform>    Remove MCP config entry from a repository

Options:
  --repo-path <path>           Target repository path (default: cwd)
  --server-name <name>         MCP server name (default: decision-ops-mcp)
  --server-url <url>           MCP server URL (default: https://api.aidecisionops.com/mcp)
  --org-id <id>                Org ID for manifest
  --project-id <id>            Project ID for manifest
  --repo-ref <ref>             Repo ref for manifest
  --default-branch <branch>    Default branch for manifest (default: main)
  --dry-run                    Show what would be done without writing
  --help, -h                   Show this help
`;

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--dry-run") {
      args["dry-run"] = true;
    } else if (arg.startsWith("--") && i + 1 < argv.length) {
      args[arg.slice(2)] = argv[++i];
    } else {
      positional.push(arg);
    }
  }
  args._command = positional[0] ?? "";
  args._subcommand = positional[1] ?? "";
  args._platform = positional[2] ?? "";
  return args;
}

function log(msg: string) {
  console.log(msg);
}

function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}

function err(msg: string) {
  console.error(`  ✗ ${msg}`);
}

const args = parseArgs(process.argv.slice(2));

if (args.help || !args._command) {
  console.log(HELP);
  process.exit(0);
}

const command = args._command as string;
const subcommand = args._subcommand as string;
const platformId = args._platform as string;

const repoPath = (args["repo-path"] as string) ?? process.cwd();
const serverName = (args["server-name"] as string) ?? "decision-ops-mcp";
const serverUrl = (args["server-url"] as string) ?? "https://api.aidecisionops.com/mcp";
const dryRun = Boolean(args["dry-run"]);

const platforms = loadPlatforms();

// ── platforms ──

if (command === "platforms") {
  log("\nAvailable platforms:\n");
  for (const p of Object.values(platforms)) {
    const caps = [
      p.skill?.supported ? "skill" : null,
      p.mcp?.supported ? "mcp" : null,
      p.manifest?.supported ? "manifest" : null,
    ]
      .filter(Boolean)
      .join(", ");
    log(`  ${p.id.padEnd(16)} ${p.display_name.padEnd(16)} [${caps}]`);
  }
  log("");
  process.exit(0);
}

// ── paths ──

if (command === "paths") {
  if (!subcommand) {
    err("Usage: decision-ops-skill paths <platform>");
    process.exit(1);
  }
  const p = platforms[subcommand];
  if (!p) {
    err(`Unknown platform: ${subcommand}`);
    process.exit(1);
  }

  const ctx = { skill_name: SKILL_NAME, repo_path: repoPath };
  log(`\nPaths for ${p.display_name}:\n`);

  if (p.skill?.supported) {
    const skillPath = resolveInstallPath(p.skill, ctx);
    log(`  skill:     ${skillPath ?? "(not resolvable)"}`);
  } else {
    log(`  skill:     (not supported)`);
  }

  if (p.mcp?.supported) {
    const mcpPath = resolveInstallPath(p.mcp, ctx);
    log(`  mcp:       ${mcpPath ?? "(not resolvable)"}`);
  } else {
    log(`  mcp:       (not supported)`);
  }

  log(`  manifest:  ${repoPath}/.decisionops/manifest.toml`);
  log("");
  process.exit(0);
}

// ── install ──

if (command === "install") {
  if (!subcommand || !platformId) {
    err("Usage: decision-ops-skill install <ide|repo|all> <platform>");
    process.exit(1);
  }

  const p = platforms[platformId];
  if (!p) {
    err(`Unknown platform: ${platformId}`);
    process.exit(1);
  }

  const ctx = { skill_name: SKILL_NAME, repo_path: repoPath };

  if (subcommand === "ide" || subcommand === "all") {
    log(`\n── IDE install: ${p.display_name} ──`);
    if (!p.skill?.supported) {
      err(`${p.display_name} does not support skill installation`);
      if (subcommand === "ide") process.exit(1);
    } else {
      const installPath = resolveInstallPath(p.skill, ctx);
      if (dryRun) {
        log(`  [dry-run] Would install skill files to: ${installPath}`);
      } else {
        const result = installSkillToIde(p, ctx, SKILL_DIR);
        ok(`Installed ${result.files.length} files to ${result.path}`);
        for (const f of result.files) {
          log(`    ${f}`);
        }
      }
    }
  }

  if (subcommand === "repo" || subcommand === "all") {
    log(`\n── Repo install: ${p.display_name} → ${repoPath} ──`);

    if (p.mcp?.supported) {
      if (dryRun) {
        const mcpPath = resolveInstallPath(p.mcp, ctx);
        log(`  [dry-run] Would write MCP config to: ${mcpPath}`);
      } else {
        const mcpResult = installMcpToRepo(p, ctx, serverName, serverUrl);
        ok(`MCP config written to ${mcpResult.path}`);
      }
    }

    const orgId = args["org-id"] as string;
    const projectId = args["project-id"] as string;
    const repoRef = args["repo-ref"] as string;

    if (orgId && projectId && repoRef) {
      const manifest: ManifestContext = {
        org_id: orgId,
        project_id: projectId,
        repo_ref: repoRef,
        default_branch: (args["default-branch"] as string) ?? "main",
        mcp_server_name: serverName,
        mcp_server_url: serverUrl,
      };
      if (dryRun) {
        log(`  [dry-run] Would write manifest to: ${repoPath}/.decisionops/manifest.toml`);
      } else {
        const manifestResult = installManifestToRepo(repoPath, manifest);
        ok(`Manifest written to ${manifestResult.path}`);
      }
    } else {
      log(`  [skip] Manifest: provide --org-id, --project-id, --repo-ref to install manifest`);
    }
  }

  // Auth instructions
  const authSteps = authInstructions(p, {
    display_name: p.display_name,
    mcp_server_name: serverName,
    mcp_server_url: serverUrl,
  });
  if (authSteps) {
    log(`\n── Next steps ──`);
    for (let i = 0; i < authSteps.length; i++) {
      log(`  ${i + 1}. ${authSteps[i]}`);
    }
  }

  log("");
  process.exit(0);
}

// ── uninstall ──

if (command === "uninstall") {
  if (!subcommand || !platformId) {
    err("Usage: decision-ops-skill uninstall <ide|repo> <platform>");
    process.exit(1);
  }

  const p = platforms[platformId];
  if (!p) {
    err(`Unknown platform: ${platformId}`);
    process.exit(1);
  }

  const ctx = { skill_name: SKILL_NAME, repo_path: repoPath };

  if (subcommand === "ide") {
    log(`\n── Uninstall IDE: ${p.display_name} ──`);
    if (!p.skill?.supported) {
      err(`${p.display_name} does not support skill installation`);
      process.exit(1);
    }
    const installPath = resolveInstallPath(p.skill, ctx);
    if (!installPath) {
      err("Cannot resolve skill install path");
      process.exit(1);
    }
    const { existsSync, rmSync } = await import("node:fs");
    if (dryRun) {
      log(`  [dry-run] Would remove: ${installPath}`);
    } else if (existsSync(installPath)) {
      rmSync(installPath, { recursive: true });
      ok(`Removed ${installPath}`);
    } else {
      log(`  [skip] Not installed: ${installPath}`);
    }
  }

  if (subcommand === "repo") {
    log(`\n── Uninstall Repo: ${p.display_name} → ${repoPath} ──`);
    if (p.mcp?.supported && p.mcp.format === "json_map") {
      const mcpPath = resolveInstallPath(p.mcp, ctx);
      if (mcpPath && (await import("node:fs")).existsSync(mcpPath)) {
        if (dryRun) {
          log(`  [dry-run] Would remove '${serverName}' from ${mcpPath}`);
        } else {
          const raw = (await import("node:fs")).readFileSync(mcpPath, "utf8");
          const config = JSON.parse(raw);
          const rootKey = p.mcp.root_key ?? "mcpServers";
          if (config[rootKey]?.[serverName]) {
            delete config[rootKey][serverName];
            (await import("node:fs")).writeFileSync(
              mcpPath,
              JSON.stringify(config, null, 2) + "\n",
            );
            ok(`Removed '${serverName}' from ${mcpPath}`);
          } else {
            log(`  [skip] '${serverName}' not found in ${mcpPath}`);
          }
        }
      }
    }
  }

  log("");
  process.exit(0);
}

err(`Unknown command: ${command}`);
console.log(HELP);
process.exit(1);
