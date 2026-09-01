import assert from 'node:assert/strict';
import { executeStatusUpdateUi } from '../src/delivery.js';
import { parseSessionKeyRoute, resolveRoute } from '../src/core.js';

function makeCtx() {
  return {
    deliveryContext: { channel: 'discord', to: 'channel:123', accountId: null },
    config: { channels: { discord: {} } },
  };
}

const fallbackCalls = [];
const richFailureApi = {
  pluginConfig: {},
  config: {},
  runtime: { channel: { outbound: { loadAdapter: async () => ({
    renderPresentation: async () => { throw new Error('rich render failed'); },
    sendPayload: async () => { throw new Error('rich send failed'); },
    sendText: async (ctx) => { fallbackCalls.push(ctx); return { messageId: 'fallback-1' }; },
  }) } } },
};
const fallbackResult = await executeStatusUpdateUi({ api: richFailureApi, ctx: makeCtx(), params: { message: '測試 fallback' } });
assert.equal(fallbackResult.isError, undefined);
assert.match(fallbackResult.content[0].text, /fallback-1/);
assert.equal(fallbackCalls.length, 1);
assert.match(fallbackCalls[0].text, /助理 正在處理|OpenClaw|測試 fallback/);

const textFailureApi = {
  pluginConfig: { style: 'text' },
  config: {},
  runtime: { channel: { outbound: { loadAdapter: async () => ({
    sendText: async () => { throw new Error('text send failed'); },
  }) } } },
};
const textFailureResult = await executeStatusUpdateUi({ api: textFailureApi, ctx: makeCtx(), params: { message: '測試失敗' } });
assert.equal(textFailureResult.isError, true);
assert.match(textFailureResult.content[0].text, /delivery outcome is unknown/);

const noRouteResult = await executeStatusUpdateUi({ api: richFailureApi, ctx: {}, params: { message: 'no route' } });
assert.equal(noRouteResult.isError, true);
assert.match(noRouteResult.content[0].text, /no current delivery route/);

// sessionKey fallback: when deliveryContext is empty, resolveRoute should parse
// the sessionKey so MCP runtimes that don't inject custom headers (e.g. claude-cli)
// can still deliver in-progress status cards.
assert.deepEqual(
  parseSessionKeyRoute('agent:main:discord:channel:1512756985181900820'),
  { channel: 'discord', to: 'channel:1512756985181900820' },
);
assert.equal(parseSessionKeyRoute(''), null);
assert.equal(parseSessionKeyRoute('not-an-agent-key'), null);
assert.equal(parseSessionKeyRoute(null), null);

const sessionKeyRoute = resolveRoute({ sessionKey: 'agent:main:discord:channel:abc' });
assert.deepEqual(sessionKeyRoute, { channel: 'discord', to: 'channel:abc', accountId: null, threadId: null });

const sessionKeyFallbackResult = await executeStatusUpdateUi({
  api: richFailureApi,
  ctx: { sessionKey: 'agent:main:discord:channel:fallback-target' },
  params: { message: 'session fallback' },
});
assert.equal(sessionKeyFallbackResult.isError, undefined);
assert.match(sessionKeyFallbackResult.content[0].text, /status_update_ui sent \(discord/);

// deliveryContext still wins over sessionKey when both are present.
const overrideRoute = resolveRoute({
  deliveryContext: { channel: 'telegram', to: 'chat:42', accountId: 'acc-1' },
  sessionKey: 'agent:main:discord:channel:abc',
});
assert.deepEqual(overrideRoute, { channel: 'telegram', to: 'chat:42', accountId: 'acc-1', threadId: null });

// Typed agent-hook context can resolve the current channel route without
// reading prompt or message fields.
assert.deepEqual(resolveRoute({
  channel: 'discord',
  chatId: 'typed-target',
  accountId: 'secondary',
}), { channel: 'discord', to: 'typed-target', accountId: 'secondary', threadId: null });

const adapterLoadFailureApi = {
  pluginConfig: {},
  config: {},
  runtime: { channel: { outbound: { loadAdapter: async () => { throw new Error('load fail'); } } } },
};
const adapterLoadResult = await executeStatusUpdateUi({ api: adapterLoadFailureApi, ctx: makeCtx(), params: { message: 'load fail' } });
assert.equal(adapterLoadResult.isError, true);
assert.match(adapterLoadResult.content[0].text, /adapter could not be loaded/);

console.log('delivery-fallback tests passed');
