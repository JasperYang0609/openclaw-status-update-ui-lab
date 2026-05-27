import assert from 'node:assert/strict';
import { executeStatusUpdateUi } from '../src/delivery.js';

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
assert.match(textFailureResult.content[0].text, /text fallback send failed/);

const noRouteResult = await executeStatusUpdateUi({ api: richFailureApi, ctx: {}, params: { message: 'no route' } });
assert.equal(noRouteResult.isError, true);
assert.match(noRouteResult.content[0].text, /no current delivery route/);

const adapterLoadFailureApi = {
  pluginConfig: {},
  config: {},
  runtime: { channel: { outbound: { loadAdapter: async () => { throw new Error('load fail'); } } } },
};
const adapterLoadResult = await executeStatusUpdateUi({ api: adapterLoadFailureApi, ctx: makeCtx(), params: { message: 'load fail' } });
assert.equal(adapterLoadResult.isError, true);
assert.match(adapterLoadResult.content[0].text, /adapter could not be loaded/);

console.log('delivery-fallback tests passed');
