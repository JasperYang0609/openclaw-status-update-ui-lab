#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOL_NAME = 'status_update_ui';
const PLUGIN_ID = 'status-update-ui-lab';
const REQUIRED_HOOKS = ['before_agent_run', 'before_prompt_build', 'before_tool_call', 'after_tool_call'];
const MARKER_START = '<!-- status-update-ui-lab:start -->';
const MARKER_END = '<!-- status-update-ui-lab:end -->';
const MARKER_REQUIREMENTS = [
  ['phase', /phase|階段/i],
  ['blocker', /blocker|卡點/i],
  ['strategy', /strategy|策略/i],
  ['verification', /validation|verification|驗證/i],
  ['decision-summary', /decision-basis summary|決策.*摘要/i],
  ['silence-window', /10[–-]15 seconds|10[–-]15 秒/i],
  ['next-step', /next action|next step|下一步/i],
  ['chain-of-thought safety', /chain-of-thought/i],
  ['raw-command safety', /raw commands?/i],
  ['secret safety', /secrets?/i],
  ['private-content safety', /private content|message bodies/i],
];

function fail(message) {
  throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function normalizedVersion(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^v/i, '');
}

export function checkVersionParity({
  packageVersion,
  manifestVersion,
  expectedVersion,
  installedMetadataVersion,
  runtimeVersion,
}, label = 'version-parity') {
  const versions = {
    package: normalizedVersion(packageVersion),
    manifest: normalizedVersion(manifestVersion),
    expected: normalizedVersion(expectedVersion),
    installed: normalizedVersion(installedMetadataVersion),
    runtime: normalizedVersion(runtimeVersion),
  };
  if (!versions.package || !versions.manifest) fail(`${label}: package and manifest versions are required`);
  const supplied = Object.entries(versions).filter(([, value]) => value);
  const distinct = new Set(supplied.map(([, value]) => value));
  if (distinct.size !== 1) {
    fail(`${label}: version mismatch (${supplied.map(([name, value]) => `${name}=${value}`).join(', ')})`);
  }
  return { label, version: versions.package, checked: supplied.map(([name]) => name) };
}

export function checkAgentMarker(text, label = 'agent-marker') {
  if (typeof text !== 'string') fail(`${label}: instruction text is required`);
  const starts = text.split(MARKER_START).length - 1;
  const ends = text.split(MARKER_END).length - 1;
  if (starts !== 1 || ends !== 1) fail(`${label}: expected exactly one managed marker block`);
  const start = text.indexOf(MARKER_START);
  const end = text.indexOf(MARKER_END, start);
  if (end <= start) fail(`${label}: managed marker order is invalid`);
  const block = text.slice(start, end + MARKER_END.length);
  for (const [name, pattern] of MARKER_REQUIREMENTS) {
    if (!pattern.test(block)) fail(`${label}: missing ${name} clause`);
  }
  return { label, clauses: MARKER_REQUIREMENTS.map(([name]) => name) };
}

export function checkStaticContract(repoRoot) {
  const manifestPath = path.join(repoRoot, 'openclaw.plugin.json');
  const packagePath = path.join(repoRoot, 'package.json');
  const entryPath = path.join(repoRoot, 'index.js');
  const pluginPath = path.join(repoRoot, 'src', 'plugin.js');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const entry = [entryPath, pluginPath]
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => fs.readFileSync(candidate, 'utf8'))
    .join('\n');

  if (manifest.id !== PLUGIN_ID) fail(`manifest plugin id must be '${PLUGIN_ID}'`);
  checkVersionParity({ packageVersion: packageJson.version, manifestVersion: manifest.version }, 'static-contract');
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
  for (const hookName of REQUIRED_HOOKS) {
    const hookRegistration = new RegExp(`api\\.on\\s*\\(\\s*["']${hookName}["']`);
    if (!hookRegistration.test(entry)) fail(`plugin must register '${hookName}' through api.on`);
  }
  return { pluginId: PLUGIN_ID, toolName: TOOL_NAME, version: packageJson.version };
}

export function checkRuntimeInspection(payload, label = 'runtime-inspect') {
  if (payload?.plugin?.id !== PLUGIN_ID) fail(`${label}: wrong plugin id`);
  const hookNames = new Set([
    ...(Array.isArray(payload?.plugin?.hookNames) ? payload.plugin.hookNames : []),
    ...(Array.isArray(payload?.typedHooks)
      ? payload.typedHooks.map((hook) => hook?.name ?? hook?.hookName).filter(Boolean)
      : []),
  ]);
  for (const hookName of REQUIRED_HOOKS) {
    if (!hookNames.has(hookName)) fail(`${label}: missing runtime hook '${hookName}'`);
  }
  if (payload?.policy?.allowPromptInjection !== true) {
    fail(`${label}: policy.allowPromptInjection must be true`);
  }
  if (payload?.policy?.allowConversationAccess !== true) {
    fail(`${label}: policy.allowConversationAccess must be true`);
  }
  return {
    label,
    version: normalizedVersion(payload?.plugin?.version),
    hookNames: REQUIRED_HOOKS,
    permissions: { allowPromptInjection: true, allowConversationAccess: true },
  };
}

function effectiveTools(payload) {
  if (!Array.isArray(payload?.groups)) fail('runtime payload must include groups[]');
  return payload.groups.flatMap((group) => (Array.isArray(group?.tools) ? group.tools : []));
}

function toolIdentity(tool) {
  const id = tool?.id ?? tool?.name;
  if (!id) return '';
  return `${id}|${tool?.source ?? 'unknown'}|${tool?.pluginId ?? ''}`;
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

export function compareEffectiveInventories(beforePayload, afterPayload, label = 'tool-inventory') {
  const before = new Set(effectiveTools(beforePayload).map(toolIdentity).filter(Boolean));
  const after = new Set(effectiveTools(afterPayload).map(toolIdentity).filter(Boolean));
  const removed = [...before].filter((identity) => !after.has(identity)).sort();
  if (removed.length > 0) fail(`${label}: tools removed after installation (${removed.join(', ')})`);
  return { label, beforeCount: before.size, afterCount: after.size, removed: [] };
}

export function classifyHarnessCoverage(payload, label = 'harness') {
  const visibility = String(payload?.typedToolLifecycleVisibility ?? '').toLowerCase();
  if (visibility === 'full') return { label, harness: payload?.harness ?? 'unknown', coverage: 'SUPPORTED' };
  if (visibility === 'partial') return { label, harness: payload?.harness ?? 'unknown', coverage: 'PARTIAL' };
  if (['unknown', 'unverified', 'none', ''].includes(visibility)) {
    return { label, harness: payload?.harness ?? 'unknown', coverage: 'UNVERIFIED' };
  }
  fail(`${label}: invalid typedToolLifecycleVisibility '${visibility}'`);
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
  try { return JSON.parse(result.stdout); } catch { fail(`${sessionKey}: gateway returned non-JSON output`); }
}

function parseArgs(argv) {
  const options = {
    sessionKeys: [], effectiveFiles: [], runtimeInspectFiles: [],
    repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--session-key' && value) { options.sessionKeys.push(value); index += 1; }
    else if (arg === '--effective-json' && value) { options.effectiveFiles.push(value); index += 1; }
    else if (arg === '--runtime-inspect-json' && value) { options.runtimeInspectFiles.push(value); index += 1; }
    else if (arg === '--effective-before-json' && value) { options.effectiveBeforeFile = value; index += 1; }
    else if (arg === '--effective-after-json' && value) { options.effectiveAfterFile = value; index += 1; }
    else if (arg === '--agent-instructions' && value) { options.agentInstructions = value; index += 1; }
    else if (arg === '--installed-metadata-json' && value) { options.installedMetadataFile = value; index += 1; }
    else if (arg === '--harness-coverage-json' && value) { options.harnessCoverageFile = value; index += 1; }
    else if (arg === '--expected-version' && value) { options.expectedVersion = value; index += 1; }
    else if (arg === '--repo-root' && value) { options.repoRoot = path.resolve(value); index += 1; }
    else if (arg === '--help') options.help = true;
    else fail(`unknown or incomplete argument: ${arg}`);
  }
  if (Boolean(options.effectiveBeforeFile) !== Boolean(options.effectiveAfterFile)) {
    fail('--effective-before-json and --effective-after-json must be supplied together');
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: node scripts/status-ui-preflight.mjs [--session-key KEY] [--runtime-inspect-json FILE] [--agent-instructions FILE] [--effective-before-json FILE --effective-after-json FILE] [--installed-metadata-json FILE] [--harness-coverage-json FILE] [--expected-version VERSION]');
    return;
  }
  const staticCheck = checkStaticContract(options.repoRoot);
  const checks = [];
  for (const file of options.effectiveFiles) checks.push(checkEffectiveInventory(readJson(file), `fixture:${file}`));
  for (const sessionKey of options.sessionKeys) checks.push(checkEffectiveInventory(queryEffectiveInventory(sessionKey), `session:${sessionKey}`));
  const hookChecks = options.runtimeInspectFiles.map((file) => checkRuntimeInspection(readJson(file), `runtime-inspect:${file}`));
  const installed = options.installedMetadataFile ? readJson(options.installedMetadataFile) : {};
  const runtimeVersions = hookChecks.map((check) => check.version).filter(Boolean);
  const versionCheck = checkVersionParity({
    packageVersion: staticCheck.version,
    manifestVersion: JSON.parse(fs.readFileSync(path.join(options.repoRoot, 'openclaw.plugin.json'), 'utf8')).version,
    expectedVersion: options.expectedVersion,
    installedMetadataVersion: installed.version ?? installed.pluginVersion,
    runtimeVersion: runtimeVersions[0],
  });
  if (new Set(runtimeVersions).size > 1) fail('version-parity: runtime inspection files disagree');
  const markerCheck = options.agentInstructions
    ? checkAgentMarker(fs.readFileSync(path.resolve(options.agentInstructions), 'utf8')) : null;
  const inventoryCheck = options.effectiveBeforeFile
    ? compareEffectiveInventories(readJson(options.effectiveBeforeFile), readJson(options.effectiveAfterFile)) : null;
  if (options.effectiveAfterFile) checkEffectiveInventory(readJson(options.effectiveAfterFile), 'effective-after');
  const harnessCheck = options.harnessCoverageFile
    ? classifyHarnessCoverage(readJson(options.harnessCoverageFile)) : null;

  console.log(`PASS static_contract plugin=${PLUGIN_ID} tool=${TOOL_NAME}`);
  console.log(`PASS version_parity version=${versionCheck.version}`);
  for (const check of checks) console.log(`PASS runtime_effective ${check.label}`);
  for (const check of hookChecks) console.log(`PASS runtime_hooks ${check.label}`);
  if (markerCheck) console.log(`PASS agent_marker clauses=${markerCheck.clauses.length}`);
  if (inventoryCheck) console.log(`PASS tool_inventory before=${inventoryCheck.beforeCount} after=${inventoryCheck.afterCount}`);
  if (harnessCheck) console.log(`${harnessCheck.coverage === 'SUPPORTED' ? 'PASS' : 'LIMITED'} harness_coverage harness=${harnessCheck.harness} coverage=${harnessCheck.coverage}`);
  if (checks.length === 0 && !options.effectiveAfterFile) console.log('NOTE runtime_effective not checked; supply target Session evidence before deployment');
  if (hookChecks.length === 0) console.log('NOTE runtime_hooks not checked; supply --runtime-inspect-json before deployment');
  if (!markerCheck) console.log('NOTE agent_marker not checked; supply --agent-instructions before deployment');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`FAIL ${error.message}`); process.exitCode = 1; }
}
