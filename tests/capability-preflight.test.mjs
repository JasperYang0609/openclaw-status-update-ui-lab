import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkEffectiveInventory,
  checkRuntimeInspection,
  checkStaticContract,
  main,
  queryEffectiveInventory,
} from '../scripts/status-ui-preflight.mjs';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
assert.deepEqual(checkStaticContract(repoRoot), {
  pluginId: 'status-update-ui-lab',
  toolName: 'status_update_ui',
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
assert.equal(checkEffectiveInventory(effective, 'parent').pluginId, 'status-update-ui-lab');
assert.throws(() => checkEffectiveInventory({ debug: { id: 'status_update_ui', source: 'plugin', pluginId: 'status-update-ui-lab' } }, 'child'), /groups/);
assert.throws(() => checkEffectiveInventory({ groups: [] }, 'child'), /not runtime-effective/);
assert.throws(
  () => checkEffectiveInventory({ groups: [{ tools: [{ id: 'status_update_ui', source: 'plugin', pluginId: 'wrong-owner' }] }] }, 'child'),
  /not owned by/,
);

const runtimeInspection = {
  plugin: {
    id: 'status-update-ui-lab',
    hookNames: ['before_agent_run', 'before_prompt_build', 'before_tool_call', 'after_tool_call'],
  },
  typedHooks: [],
};
assert.equal(checkRuntimeInspection(runtimeInspection).hookNames.length, 4);
assert.throws(
  () => checkRuntimeInspection({ plugin: { id: 'status-update-ui-lab', hookNames: ['before_prompt_build'] } }),
  /missing runtime hook/,
);
assert.throws(
  () => queryEffectiveInventory('agent:test:discord:channel:fixture', 'definitely-not-a-real-openclaw-command'),
  /gateway query failed/,
);

const effectiveFile = path.join(os.tmpdir(), `status-ui-effective-${process.pid}.json`);
const runtimeFile = path.join(os.tmpdir(), `status-ui-runtime-${process.pid}.json`);
fs.writeFileSync(effectiveFile, JSON.stringify(effective));
fs.writeFileSync(runtimeFile, JSON.stringify(runtimeInspection));
try {
  main(['--effective-json', effectiveFile, '--runtime-inspect-json', runtimeFile]);
} finally {
  fs.rmSync(effectiveFile, { force: true });
  fs.rmSync(runtimeFile, { force: true });
}

console.log('capability-preflight tests passed');
