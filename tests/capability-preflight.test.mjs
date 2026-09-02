import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkAgentMarker,
  checkEffectiveInventory,
  checkRuntimeInspection,
  checkStaticContract,
  checkVersionParity,
  classifyHarnessCoverage,
  compareEffectiveInventories,
  main,
  queryEffectiveInventory,
} from '../scripts/status-ui-preflight.mjs';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
assert.deepEqual(checkStaticContract(repoRoot), {
  pluginId: 'status-update-ui-lab',
  toolName: 'status_update_ui',
  version: '0.4.0',
});

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'status-ui-preflight-'));
try {
  fs.mkdirSync(path.join(tempRoot, 'src'));
  for (const file of ['package.json', 'openclaw.plugin.json', 'index.js', 'src/plugin.js']) {
    fs.mkdirSync(path.dirname(path.join(tempRoot, file)), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, file), path.join(tempRoot, file));
  }
  const manifestPath = path.join(tempRoot, 'openclaw.plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.contracts.tools = [];
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(() => checkStaticContract(tempRoot), /contracts\.tools/);
  manifest.contracts.tools = ['status_update_ui'];
  manifest.toolMetadata.status_update_ui.optional = true;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(() => checkStaticContract(tempRoot), /optional must be false/);
  manifest.toolMetadata.status_update_ui.optional = false;
  manifest.version = '9.9.9';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(() => checkStaticContract(tempRoot), /version mismatch/);
  manifest.version = '0.4.0';
  manifest.id = 'wrong-plugin';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(() => checkStaticContract(tempRoot), /plugin id/);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const effective = {
  groups: [{
    id: 'plugin',
    source: 'plugin',
    tools: [{ id: 'status_update_ui', source: 'plugin', pluginId: 'status-update-ui-lab' }],
  }],
};
const effectiveWithExec = {
  groups: [{
    id: 'plugin', source: 'plugin',
    tools: [
      { id: 'exec', source: 'core' },
      { id: 'status_update_ui', source: 'plugin', pluginId: 'status-update-ui-lab' },
    ],
  }],
};
assert.equal(checkEffectiveInventory(effective, 'parent').pluginId, 'status-update-ui-lab');
assert.throws(() => checkEffectiveInventory({ debug: { id: 'status_update_ui', source: 'plugin', pluginId: 'status-update-ui-lab' } }, 'child'), /groups/);
assert.throws(() => checkEffectiveInventory({ groups: [] }, 'child'), /not runtime-effective/);
assert.throws(
  () => checkEffectiveInventory({ groups: [{ tools: [{ id: 'status_update_ui', source: 'plugin', pluginId: 'wrong-owner' }] }] }, 'child'),
  /not owned by/,
);
assert.equal(compareEffectiveInventories(effectiveWithExec, effectiveWithExec).removed.length, 0);
assert.throws(() => compareEffectiveInventories(effectiveWithExec, effective), /tools removed/);

assert.equal(checkVersionParity({ packageVersion: '0.4.0', manifestVersion: 'v0.4.0' }).version, '0.4.0');
assert.throws(
  () => checkVersionParity({ packageVersion: '0.4.0', manifestVersion: '0.4.0', runtimeVersion: '0.3.1' }),
  /version mismatch/,
);

const marker = `
<!-- status-update-ui-lab:start -->
phase blocker strategy validation decision-basis summary 10–15 seconds next action
chain-of-thought raw commands secrets private content
<!-- status-update-ui-lab:end -->`;
assert.equal(checkAgentMarker(marker).clauses.length, 11);
assert.throws(() => checkAgentMarker(`${marker}\n${marker}`), /exactly one/);
assert.throws(() => checkAgentMarker(marker.replace('next action', 'later')), /next-step/);

assert.equal(classifyHarnessCoverage({ harness: 'openclaw', typedToolLifecycleVisibility: 'full' }).coverage, 'SUPPORTED');
assert.equal(classifyHarnessCoverage({ harness: 'codex', typedToolLifecycleVisibility: 'partial' }).coverage, 'PARTIAL');
assert.equal(classifyHarnessCoverage({ harness: 'unknown', typedToolLifecycleVisibility: 'unverified' }).coverage, 'UNVERIFIED');
assert.throws(() => classifyHarnessCoverage({ typedToolLifecycleVisibility: 'claimed-supported' }), /invalid/);

const runtimeInspection = {
  plugin: {
    id: 'status-update-ui-lab',
    version: '0.4.0',
    hookNames: ['before_agent_run', 'before_prompt_build', 'before_tool_call', 'after_tool_call'],
  },
  typedHooks: [],
  policy: {
    allowPromptInjection: true,
    allowConversationAccess: true,
  },
};
assert.equal(checkRuntimeInspection(runtimeInspection).hookNames.length, 4);
assert.throws(
  () => checkRuntimeInspection({
    plugin: { id: 'status-update-ui-lab', hookNames: ['before_prompt_build'] },
    policy: { allowPromptInjection: true, allowConversationAccess: true },
  }),
  /missing runtime hook/,
);
assert.throws(
  () => checkRuntimeInspection({
    ...runtimeInspection,
    policy: { allowPromptInjection: false, allowConversationAccess: true },
  }),
  /allowPromptInjection must be true/,
);
assert.throws(
  () => checkRuntimeInspection({
    ...runtimeInspection,
    policy: { allowPromptInjection: true, allowConversationAccess: false },
  }),
  /allowConversationAccess must be true/,
);
assert.throws(
  () => queryEffectiveInventory('agent:test:discord:channel:fixture', 'definitely-not-a-real-openclaw-command'),
  /gateway query failed/,
);

const effectiveFile = path.join(os.tmpdir(), `status-ui-effective-${process.pid}.json`);
const effectiveBeforeFile = path.join(os.tmpdir(), `status-ui-effective-before-${process.pid}.json`);
const effectiveAfterFile = path.join(os.tmpdir(), `status-ui-effective-after-${process.pid}.json`);
const runtimeFile = path.join(os.tmpdir(), `status-ui-runtime-${process.pid}.json`);
const markerFile = path.join(os.tmpdir(), `status-ui-marker-${process.pid}.md`);
const harnessFile = path.join(os.tmpdir(), `status-ui-harness-${process.pid}.json`);
const installedFile = path.join(os.tmpdir(), `status-ui-installed-${process.pid}.json`);
fs.writeFileSync(effectiveFile, JSON.stringify(effective));
fs.writeFileSync(effectiveBeforeFile, JSON.stringify({ groups: [{ tools: [{ id: 'exec', source: 'core' }] }] }));
fs.writeFileSync(effectiveAfterFile, JSON.stringify(effectiveWithExec));
fs.writeFileSync(runtimeFile, JSON.stringify(runtimeInspection));
fs.writeFileSync(markerFile, marker);
fs.writeFileSync(harnessFile, JSON.stringify({ harness: 'codex', typedToolLifecycleVisibility: 'partial' }));
fs.writeFileSync(installedFile, JSON.stringify({ version: '0.4.0' }));
try {
  main([
    '--effective-json', effectiveFile,
    '--effective-before-json', effectiveBeforeFile,
    '--effective-after-json', effectiveAfterFile,
    '--runtime-inspect-json', runtimeFile,
    '--agent-instructions', markerFile,
    '--harness-coverage-json', harnessFile,
    '--installed-metadata-json', installedFile,
    '--expected-version', '0.4.0',
  ]);
} finally {
  fs.rmSync(effectiveFile, { force: true });
  fs.rmSync(effectiveBeforeFile, { force: true });
  fs.rmSync(effectiveAfterFile, { force: true });
  fs.rmSync(runtimeFile, { force: true });
  fs.rmSync(markerFile, { force: true });
  fs.rmSync(harnessFile, { force: true });
  fs.rmSync(installedFile, { force: true });
}

console.log('capability-preflight tests passed');
