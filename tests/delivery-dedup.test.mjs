import assert from 'node:assert/strict';
import { clearDeliveryGuardForTest, executeStatusUpdateUi } from '../src/delivery.js';
import { buildAttemptKey, createDeliveryGuard, resolveGuardConfig, resolveSessionIdentity } from '../src/delivery-guard.js';

function makeCtx({
  sessionKey = 'agent:main:discord:channel:123',
  to = 'channel:123',
  accountId = 'default',
  threadId = null,
} = {}) {
  return {
    sessionKey,
    deliveryContext: { channel: 'discord', to, accountId, threadId },
    config: { channels: { discord: {} } },
  };
}

function makeApi({ sendPayload, sendText, renderPresentation, pluginConfig = {} }) {
  return {
    pluginConfig,
    config: {},
    runtime: { channel: { outbound: { loadAdapter: async () => ({
      renderPresentation: renderPresentation ?? (async ({ payload }) => payload),
      sendPayload,
      sendText,
    }) } } },
  };
}

clearDeliveryGuardForTest();

assert.equal(resolveSessionIdentity({ runId: 'run-wins', sessionKey: 'session-loses' }), 'run-wins');

// A rejected platform send is ambiguous: never send a fallback that could duplicate it.
let unknownPayloadCalls = 0;
let unknownFallbackCalls = 0;
const unknownApi = makeApi({
  sendPayload: async () => {
    unknownPayloadCalls += 1;
    throw new Error('HTTP/2 response lost after platform acceptance');
  },
  sendText: async () => {
    unknownFallbackCalls += 1;
    return { messageId: 'must-not-send' };
  },
});
const unknownCtx = makeCtx();
const unknownResult = await executeStatusUpdateUi({ api: unknownApi, ctx: unknownCtx, params: { message: '同一進度' } });
assert.equal(unknownResult.isError, true);
assert.match(unknownResult.content[0].text, /outcome is unknown/);
assert.equal(unknownPayloadCalls, 1);
assert.equal(unknownFallbackCalls, 0);

// A retry in the same session and route is suppressed while outcome remains unknown.
const suppressedResult = await executeStatusUpdateUi({ api: unknownApi, ctx: unknownCtx, params: { message: '同一進度' } });
assert.equal(suppressedResult.isError, undefined);
assert.match(suppressedResult.content[0].text, /suppressed a recent duplicate \(unknown/);
assert.equal(unknownPayloadCalls, 1);

// A null/undefined rich result is also ambiguous and must not trigger fallback.
clearDeliveryGuardForTest();
let emptyResultFallbackCalls = 0;
const emptyResultApi = makeApi({
  sendPayload: async () => undefined,
  sendText: async () => {
    emptyResultFallbackCalls += 1;
    return { messageId: 'must-not-send-empty-result' };
  },
});
const emptyResult = await executeStatusUpdateUi({
  api: emptyResultApi,
  ctx: makeCtx(),
  params: { message: '空回應' },
});
assert.equal(emptyResult.isError, true);
assert.match(emptyResult.content[0].text, /no delivery result was returned/);
assert.equal(emptyResultFallbackCalls, 0);

// Runtime contexts that expose sessionId instead of sessionKey still get isolation.
clearDeliveryGuardForTest();
let sessionIdCalls = 0;
const sessionIdApi = makeApi({
  sendPayload: async () => {
    sessionIdCalls += 1;
    throw new Error('ambiguous');
  },
  sendText: async () => { throw new Error('unexpected fallback'); },
});
const sessionIdCtx = makeCtx();
delete sessionIdCtx.sessionKey;
sessionIdCtx.sessionId = 'runtime-session-id';
await executeStatusUpdateUi({ api: sessionIdApi, ctx: sessionIdCtx, params: { message: 'sessionId 進度' } });
const sessionIdRetry = await executeStatusUpdateUi({ api: sessionIdApi, ctx: sessionIdCtx, params: { message: 'sessionId 進度' } });
assert.match(sessionIdRetry.content[0].text, /suppressed a recent duplicate/);
assert.equal(sessionIdCalls, 1);

// Identical text from another session is independent and must be delivered.
let crossSessionCalls = 0;
const crossSessionApi = makeApi({
  sendPayload: async () => {
    crossSessionCalls += 1;
    return { messageId: `cross-${crossSessionCalls}` };
  },
  sendText: async () => { throw new Error('unexpected fallback'); },
});
const crossSessionResult = await executeStatusUpdateUi({
  api: crossSessionApi,
  ctx: makeCtx({ sessionKey: 'agent:other:discord:channel:123' }),
  params: { message: '同一進度' },
});
assert.equal(crossSessionResult.isError, undefined);
assert.equal(crossSessionCalls, 1);

// Confirmed duplicate calls are also suppressed inside the short window.
clearDeliveryGuardForTest();
let confirmedCalls = 0;
const confirmedApi = makeApi({
  sendPayload: async () => {
    confirmedCalls += 1;
    return { messageId: `confirmed-${confirmedCalls}` };
  },
  sendText: async () => { throw new Error('unexpected fallback'); },
});
const confirmedCtx = makeCtx();
const confirmedFirst = await executeStatusUpdateUi({ api: confirmedApi, ctx: confirmedCtx, params: { message: '確認進度' } });
const confirmedSecond = await executeStatusUpdateUi({ api: confirmedApi, ctx: confirmedCtx, params: { message: '確認進度' } });
assert.match(confirmedFirst.content[0].text, /confirmed-1/);
assert.match(confirmedSecond.content[0].text, /suppressed a recent duplicate \(confirmed/);
assert.equal(confirmedCalls, 1);

// Concurrent duplicate calls in one Session are coalesced while different Sessions remain independent.
clearDeliveryGuardForTest();
let concurrentCalls = 0;
const concurrentApi = makeApi({
  sendPayload: async () => {
    concurrentCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { messageId: `concurrent-${concurrentCalls}` };
  },
  sendText: async () => { throw new Error('unexpected fallback'); },
});
const [sameSessionA, sameSessionB] = await Promise.all([
  executeStatusUpdateUi({ api: concurrentApi, ctx: makeCtx(), params: { message: '併發進度' } }),
  executeStatusUpdateUi({ api: concurrentApi, ctx: makeCtx(), params: { message: '併發進度' } }),
]);
assert.equal(concurrentCalls, 1);
assert.ok(
  [sameSessionA, sameSessionB].some((result) => /suppressed a recent duplicate/.test(result.content[0].text)),
);

clearDeliveryGuardForTest();
concurrentCalls = 0;
await Promise.all([
  executeStatusUpdateUi({
    api: concurrentApi,
    ctx: makeCtx({ sessionKey: 'agent:a:discord:channel:123' }),
    params: { message: '跨 Session 併發' },
  }),
  executeStatusUpdateUi({
    api: concurrentApi,
    ctx: makeCtx({ sessionKey: 'agent:b:discord:channel:123' }),
    params: { message: '跨 Session 併發' },
  }),
]);
assert.equal(concurrentCalls, 2);

// Route dimensions isolate attempts even when session and text are identical.
clearDeliveryGuardForTest();
let routeCalls = 0;
const routeApi = makeApi({
  sendPayload: async () => ({ messageId: `route-${++routeCalls}` }),
  sendText: async () => { throw new Error('unexpected fallback'); },
});
for (const ctx of [
  makeCtx({ to: 'channel:123' }),
  makeCtx({ to: 'channel:456' }),
  makeCtx({ accountId: 'secondary' }),
  makeCtx({ threadId: 'thread-1' }),
]) {
  const result = await executeStatusUpdateUi({ api: routeApi, ctx, params: { message: '路由隔離' } });
  assert.equal(result.isError, undefined);
}
assert.equal(routeCalls, 4);

// Guard configuration clamps unsafe values to documented limits.
assert.deepEqual(resolveGuardConfig({ dedupeWindowMs: -1, guardMaxEntries: 1 }), {
  dedupeWindowMs: 1_000,
  guardMaxEntries: 100,
});
assert.deepEqual(resolveGuardConfig({ dedupeWindowMs: 999_999, guardMaxEntries: 99_999 }), {
  dedupeWindowMs: 120_000,
  guardMaxEntries: 10_000,
});

// Direct guard tests verify TTL expiry and bounded cleanup deterministically.
const guard = createDeliveryGuard();
const guardConfig = { dedupeWindowMs: 1_000, guardMaxEntries: 100 };
const route = { channel: 'discord', to: 'channel:123', accountId: 'default', threadId: null };
const firstKey = buildAttemptKey({ route, sessionIdentity: 'session-1', message: 'ttl' });
assert.equal(guard.acquire(firstKey, { ...guardConfig, now: 0 }).suppressed, false);
guard.mark(firstKey, 'confirmed');
assert.equal(guard.acquire(firstKey, { ...guardConfig, now: 500 }).suppressed, true);
guard.mark(firstKey, 'confirmed', { now: 500, dedupeWindowMs: 1_000 });
assert.equal(guard.acquire(firstKey, { ...guardConfig, now: 1_001 }).suppressed, true);
assert.equal(guard.acquire(firstKey, { ...guardConfig, now: 1_501 }).suppressed, false);

// Dispatching entries retain an active lease beyond the terminal dedupe TTL.
const dispatchKey = buildAttemptKey({ route, sessionIdentity: 'dispatching', message: 'slow send' });
assert.equal(guard.acquire(dispatchKey, { ...guardConfig, now: 2_000 }).suppressed, false);
guard.mark(dispatchKey, 'dispatching', { now: 2_000, dedupeWindowMs: 1_000 });
assert.equal(guard.acquire(dispatchKey, { ...guardConfig, now: 3_200 }).suppressed, true);

guard.clear();
for (let index = 0; index < 110; index += 1) {
  const key = buildAttemptKey({ route, sessionIdentity: `capacity-${index}`, message: 'bounded' });
  const claim = guard.acquire(key, { dedupeWindowMs: 120_000, guardMaxEntries: 100, now: 4_000 + index });
  if (index < 100) assert.equal(claim.saturated, undefined);
  else assert.equal(claim.saturated, true);
}
assert.ok(guard.size() <= 100);
const oldestActiveKey = buildAttemptKey({ route, sessionIdentity: 'capacity-0', message: 'bounded' });
assert.equal(
  guard.acquire(oldestActiveKey, { dedupeWindowMs: 120_000, guardMaxEntries: 100, now: 5_000 }).suppressed,
  true,
);

// Unexpired terminal outcomes are also retained; capacity saturation must fail closed.
guard.clear();
for (let index = 0; index < 100; index += 1) {
  const key = buildAttemptKey({ route, sessionIdentity: `terminal-${index}`, message: 'terminal bounded' });
  guard.acquire(key, { dedupeWindowMs: 120_000, guardMaxEntries: 100, now: 10_000 });
  guard.mark(key, 'unknown', { now: 10_000, dedupeWindowMs: 120_000 });
}
const terminalOverflowKey = buildAttemptKey({ route, sessionIdentity: 'terminal-overflow', message: 'terminal bounded' });
assert.equal(
  guard.acquire(terminalOverflowKey, { dedupeWindowMs: 120_000, guardMaxEntries: 100, now: 10_001 }).saturated,
  true,
);
const oldestTerminalKey = buildAttemptKey({ route, sessionIdentity: 'terminal-0', message: 'terminal bounded' });
assert.equal(
  guard.acquire(oldestTerminalKey, { dedupeWindowMs: 120_000, guardMaxEntries: 100, now: 10_002 }).suppressed,
  true,
);

// Once entries expire, cleanup frees capacity normally.
assert.equal(
  guard.acquire(terminalOverflowKey, { dedupeWindowMs: 120_000, guardMaxEntries: 100, now: 130_001 }).saturated,
  undefined,
);

console.log('delivery-dedup tests passed');
