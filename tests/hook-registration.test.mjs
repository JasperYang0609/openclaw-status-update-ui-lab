import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerStatusUpdateUiPlugin } from '../src/plugin.js';

const hooks = new Map();
const tools = [];
const api = {
  pluginConfig: { enforcementMode: 'prompt' },
  config: {},
  registerTool(factory, options) {
    tools.push({ factory, options });
  },
  on(name, handler) {
    hooks.set(name, handler);
  },
};

registerStatusUpdateUiPlugin(api);
assert.equal(tools.length, 1);
assert.equal(tools[0].options.name, 'status_update_ui');
for (const name of ['before_agent_run', 'before_prompt_build', 'before_tool_call', 'after_tool_call']) {
  assert.equal(typeof hooks.get(name), 'function', `${name} must be registered`);
}

const event = new Proxy({ accountId: 'default' }, {
  get(target, property) {
    if (['prompt', 'messages', 'systemPrompt'].includes(String(property))) {
      throw new Error(`forbidden conversation field read: ${String(property)}`);
    }
    return Reflect.get(target, property);
  },
});
const pass = await hooks.get('before_agent_run')(event, {
  runId: 'run-registration',
  sessionKey: 'agent:main:discord:channel:123',
  sessionId: 'session-registration',
  channel: 'discord',
  chatId: '123',
  channelId: '123',
  trigger: 'user',
});
assert.deepEqual(pass, { outcome: 'pass' });
assert.match(
  hooks.get('before_prompt_build')({}, {})?.appendSystemContext ?? '',
  /final answer must remain an ordinary assistant reply/,
);

const hybridHooks = new Map();
registerStatusUpdateUiPlugin({
  pluginConfig: { enforcementMode: 'hybrid' },
  config: {},
  registerTool() {},
  on(name, handler) { hybridHooks.set(name, handler); },
  runtime: { channel: { outbound: { loadAdapter: async () => { throw new Error('adapter unavailable'); } } } },
});
assert.deepEqual(await hybridHooks.get('before_agent_run')({ accountId: 'default' }, {
  runId: 'run-fail-open',
  sessionKey: 'agent:main:discord:channel:123',
  sessionId: 'session-fail-open',
  channel: 'discord',
  chatId: '123',
  channelId: '123',
  trigger: 'user',
}), { outcome: 'pass' });

const enforcementCalls = [];
const injectedHooks = new Map();
registerStatusUpdateUiPlugin({
  pluginConfig: {},
  registerTool() {},
  on(name, handler) { injectedHooks.set(name, handler); },
}, { enforcement: {
  async start() { enforcementCalls.push('start'); },
  beforeTool() { enforcementCalls.push('beforeTool'); },
  afterTool() { enforcementCalls.push('afterTool'); },
  noteProgress() { enforcementCalls.push('noteProgress'); },
} });
injectedHooks.get('before_tool_call')({ toolName: 'status_update_ui', runId: 'run-status' }, { runId: 'run-status' });
injectedHooks.get('after_tool_call')({ toolName: 'status_update_ui', runId: 'run-status' }, { runId: 'run-status' });
injectedHooks.get('before_tool_call')({ toolName: 'exec', runId: 'run-exec' }, { runId: 'run-exec' });
injectedHooks.get('after_tool_call')({ toolName: 'exec', runId: 'run-exec' }, { runId: 'run-exec' });
assert.deepEqual(enforcementCalls, ['noteProgress', 'beforeTool', 'afterTool']);

const manifest = JSON.parse(fs.readFileSync(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'));
assert.equal(manifest.version, '0.3.0');
assert.deepEqual(manifest.configSchema.properties.enforcementMode.enum, ['off', 'prompt', 'hybrid']);
assert.equal(manifest.configSchema.properties.autoWaitAfterMs.minimum, 0);
assert.equal(manifest.configSchema.properties.turnStateTtlMs.maximum, 3_600_000);
assert.equal(manifest.configSchema.properties.turnToolTimerMaxEntries.maximum, 1_000);

console.log('hook-registration tests passed');
