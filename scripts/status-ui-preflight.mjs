#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOL_NAME = 'status_update_ui';
const PLUGIN_ID = 'status-update-ui-lab';

function fail(message) {
  throw new Error(message);
}

export function checkStaticContract(repoRoot) {
  const manifestPath = path.join(repoRoot, 'openclaw.plugin.json');
  const packagePath = path.join(repoRoot, 'package.json');
  const entryPath = path.join(repoRoot, 'index.js');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const entry = fs.readFileSync(entryPath, 'utf8');

  if (manifest.id !== PLUGIN_ID) fail(`manifest plugin id must be '${PLUGIN_ID}'`);
  if (!manifest.contracts?.tools?.includes(TOOL_NAME)) {
    fail(`manifest contracts.tools must include '${TOOL_NAME}'`);
  }
  if (manifest.toolMetadata?.[TOOL_NAME]?.optional !== false) {
    fail(`manifest toolMetadata.${TOOL_NAME}.optional must be false`);
  }
  if (!packageJson.openclaw?.extensions?.includes('./index.js')) {
    fail("package openclaw.extensions must include './index.js'");
  }
  const registration = new RegExp(
    `api\\.registerTool\\s*\\([\\s\\S]*?name\\s*:\\s*["']${TOOL_NAME}["']`,
  );
  if (!registration.test(entry)) fail(`index.js must register '${TOOL_NAME}' through api.registerTool`);
  return { pluginId: PLUGIN_ID, toolName: TOOL_NAME };
}

function effectiveTools(payload) {
  if (!Array.isArray(payload?.groups)) fail("runtime payload must include groups[]");
  return payload.groups.flatMap((group) => (Array.isArray(group?.tools) ? group.tools : []));
}

export function checkEffectiveInventory(payload, label = 'runtime') {
  const matches = effectiveTools(payload).filter(
    (tool) => tool?.id === TOOL_NAME || tool?.name === TOOL_NAME,
  );
  if (matches.length === 0) fail(`${label}: '${TOOL_NAME}' is not runtime-effective`);
  const owned = matches.find((tool) => tool.source === 'plugin' && tool.pluginId === PLUGIN_ID);
  if (!owned) {
    const owners = matches.map((tool) => `${tool.source ?? 'unknown'}/${tool.pluginId ?? 'unknown'}`).join(', ');
    fail(`${label}: '${TOOL_NAME}' is not owned by '${PLUGIN_ID}' (found ${owners})`);
  }
  return { label, pluginId: owned.pluginId, toolName: owned.id ?? owned.name };
}

export function queryEffectiveInventory(sessionKey, command = 'openclaw') {
  const result = spawnSync(
    command,
    ['gateway', 'call', 'tools.effective', '--params', JSON.stringify({ sessionKey }), '--json'],
    { encoding: 'utf8', timeout: 30_000 },
  );
  if (result.error) fail(`${sessionKey}: gateway query failed (${result.error.message})`);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().split('\n').at(-1) || `exit ${result.status}`;
    fail(`${sessionKey}: gateway query failed (${detail})`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`${sessionKey}: gateway returned non-JSON output`);
  }
}

function parseArgs(argv) {
  const options = { sessionKeys: [], effectiveFiles: [], repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--session-key' && value) { options.sessionKeys.push(value); index += 1; }
    else if (arg === '--effective-json' && value) { options.effectiveFiles.push(value); index += 1; }
    else if (arg === '--repo-root' && value) { options.repoRoot = path.resolve(value); index += 1; }
    else if (arg === '--help') options.help = true;
    else fail(`unknown or incomplete argument: ${arg}`);
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: node scripts/status-ui-preflight.mjs [--session-key KEY ...] [--effective-json FILE ...]');
    return;
  }
  checkStaticContract(options.repoRoot);
  const checks = [];
  for (const file of options.effectiveFiles) {
    checks.push(checkEffectiveInventory(JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')), `fixture:${file}`));
  }
  for (const sessionKey of options.sessionKeys) {
    checks.push(checkEffectiveInventory(queryEffectiveInventory(sessionKey), `session:${sessionKey}`));
  }
  console.log(`PASS static_contract plugin=${PLUGIN_ID} tool=${TOOL_NAME}`);
  for (const check of checks) console.log(`PASS runtime_effective ${check.label}`);
  if (checks.length === 0) {
    console.log('NOTE runtime_effective not checked; supply parent/subagent --session-key values before deployment');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`FAIL ${error.message}`); process.exitCode = 1; }
}
