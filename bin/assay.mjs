#!/usr/bin/env node
// Assay CLI — single binary, install + verify + doctor.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const HOME = homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? join(HOME, ".claude");
const ASSAY_DIR = join(HOME, ".assay");
const PLUGIN_DEST = join(CLAUDE_DIR, "plugins", "marketplaces", "assaylabs", "assay");

const cmd = process.argv[2];

function info(msg) { console.log(`  ${msg}`); }
function ok(msg)   { console.log(`  ✓ ${msg}`); }
function warn(msg) { console.log(`  ! ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); }

function ensureBuilt() {
  const dist = join(REPO_ROOT, "dist", "index.js");
  if (!existsSync(dist)) {
    info("Building TypeScript...");
    execSync("npm run build", { cwd: REPO_ROOT, stdio: "inherit" });
  }
}

function checkClaudeMem() {
  try {
    const out = execSync("curl -sS http://localhost:37701/api/health", { encoding: "utf8" });
    const body = JSON.parse(out);
    if (body.status === "ok") return { ok: true, version: body.version, port: 37701 };
  } catch {}
  for (let uid = 0; uid < 100; uid++) {
    const port = 37700 + uid;
    try {
      const out = execSync(`curl -sS --max-time 1 http://localhost:${port}/api/health`, { encoding: "utf8" });
      const body = JSON.parse(out);
      if (body.status === "ok") return { ok: true, version: body.version, port };
    } catch {}
  }
  return { ok: false };
}

function install() {
  console.log("\nassay install\n");

  ensureBuilt();

  info("Creating plugin destination...");
  mkdirSync(PLUGIN_DEST, { recursive: true });

  info("Copying plugin files...");
  for (const item of ["plugin", "dist", "node_modules", "package.json", ".mcp.json"]) {
    const src = join(REPO_ROOT, item);
    if (!existsSync(src)) {
      if (item === "node_modules") {
        warn(`${item} missing — running npm install first`);
        execSync("npm install --omit=dev --omit=optional", { cwd: REPO_ROOT, stdio: "inherit" });
      } else {
        warn(`${item} not found, skipping`);
        continue;
      }
    }
    cpSync(src, join(PLUGIN_DEST, item), { recursive: true });
  }
  ok(`Plugin installed at ${PLUGIN_DEST}`);

  info("Creating ~/.assay directory...");
  mkdirSync(ASSAY_DIR, { recursive: true });
  mkdirSync(join(ASSAY_DIR, "analytics"), { recursive: true });
  ok(`Workspace at ${ASSAY_DIR}`);

  console.log("\nInstallation complete.");
  console.log("\nNext steps:");
  console.log("  1. Make sure claude-mem is installed and its worker is running:");
  console.log("       npx claude-mem install && npx claude-mem start");
  console.log("  2. Restart Claude Code (Cmd+Q on macOS) so it discovers the new plugin.");
  console.log("  3. In any Claude Code session, tag a decision inline:");
  console.log("       <assay-decision kind=\"decision\">Your decision text.</assay-decision>");
  console.log("  4. End the session (Stop event fires). Decision persists to ~/.assay/decisions.db.");
  console.log("  5. In a new session, invoke /assay-decision to recall.");
  console.log("\nRun  assay doctor  to verify the install.\n");
}

function doctor() {
  console.log("\nassay doctor\n");

  let allOk = true;

  if (existsSync(PLUGIN_DEST)) {
    ok(`plugin installed at ${PLUGIN_DEST}`);
  } else {
    fail(`plugin NOT installed (expected at ${PLUGIN_DEST})`);
    fail(`  fix: npx assay install`);
    allOk = false;
  }

  if (existsSync(ASSAY_DIR)) {
    ok(`workspace exists at ${ASSAY_DIR}`);
  } else {
    fail(`workspace missing (expected at ${ASSAY_DIR})`);
    allOk = false;
  }

  const dbPath = join(ASSAY_DIR, "decisions.db");
  if (existsSync(dbPath)) {
    const size = statSync(dbPath).size;
    ok(`decisions.db exists (${(size / 1024).toFixed(1)}KB)`);
  } else {
    info(`decisions.db not yet created — will appear on first Stop event with a tag`);
  }

  const cm = checkClaudeMem();
  if (cm.ok) {
    ok(`claude-mem worker reachable on port ${cm.port} (v${cm.version})`);
  } else {
    fail(`claude-mem worker NOT reachable on any port 37700-37799`);
    fail(`  fix: npx claude-mem start`);
    allOk = false;
  }

  const hooksPath = join(PLUGIN_DEST, "plugin", "hooks", "hooks.json");
  if (existsSync(hooksPath)) {
    try {
      const hooks = JSON.parse(readFileSync(hooksPath, "utf8"));
      if (hooks.hooks?.Stop) ok(`Stop hook registered`);
      else { fail(`hooks.json present but Stop hook missing`); allOk = false; }
    } catch (err) {
      fail(`hooks.json unreadable: ${err.message}`);
      allOk = false;
    }
  }

  const mcpPath = join(PLUGIN_DEST, ".mcp.json");
  if (existsSync(mcpPath)) {
    try {
      const mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
      if (mcp.mcpServers?.assay) ok(`MCP server registered as 'assay'`);
      else { fail(`.mcp.json present but assay server missing`); allOk = false; }
    } catch (err) {
      fail(`.mcp.json unreadable: ${err.message}`);
      allOk = false;
    }
  }

  console.log(allOk ? "\n  All checks passed.\n" : "\n  Some checks failed. See fixes above.\n");
  process.exit(allOk ? 0 : 1);
}

function smoke() {
  ensureBuilt();
  execSync("node scripts/smoke-v2-integration.mjs", { cwd: REPO_ROOT, stdio: "inherit" });
}

function demo() {
  ensureBuilt();
  execSync("node scripts/demo-end-to-end.mjs", { cwd: REPO_ROOT, stdio: "inherit" });
}

function uninstall() {
  if (existsSync(PLUGIN_DEST)) {
    execSync(`rm -rf "${PLUGIN_DEST}"`);
    ok(`removed ${PLUGIN_DEST}`);
  } else {
    info(`nothing to remove at ${PLUGIN_DEST}`);
  }
  console.log("\nNote: ~/.assay/decisions.db preserved. Remove with: rm -rf ~/.assay");
  console.log("Restart Claude Code to pick up the uninstall.");
}

function help() {
  console.log(`
assay — typed decision-graph judgment function for Claude Code

USAGE:
  assay <command>

COMMANDS:
  install     Install the plugin into Claude Code (~/.claude/plugins/...)
  doctor      Verify the install + worker + DB state
  smoke       Run the integration smoke pack (16+ cases)
  demo        Run an end-to-end demo proving the system works
  uninstall   Remove the plugin (preserves ~/.assay data)
  help        Show this help

QUICK START:
  npx claude-mem install && npx claude-mem start    # substrate
  npx assay install                              # this plugin
  assay doctor                                   # verify
  # restart Claude Code, then tag <assay-decision>...</assay-decision> in any session
`);
}

switch (cmd) {
  case "install":   install(); break;
  case "doctor":    doctor(); break;
  case "smoke":     smoke(); break;
  case "demo":      demo(); break;
  case "uninstall": uninstall(); break;
  case undefined:
  case "help":
  case "--help":
  case "-h":        help(); break;
  default:
    fail(`unknown command: ${cmd}`);
    help();
    process.exit(1);
}
