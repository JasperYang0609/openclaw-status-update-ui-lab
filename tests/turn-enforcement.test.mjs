import assert from 'node:assert/strict';
import {
  buildPromptGuidance,
  createTurnEnforcement,
  enforcementDefaults,
  resolveAutomaticRoute,
  resolveEnforcementConfig,
} from '../src/turn-enforcement.js';

function createFakeClock() {
  let current = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    now: () => current,
    setTimeoutFn(fn, delay) {
      const id = ++sequence;
      timers.set(id, { at: current + delay, fn });
      return id;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
    async advance(ms) {
      current += ms;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= current)
        .sort((left, right) => left[1].at - right[1].at);
      for (const [id, timer] of due) {
        if (!timers.delete(id)) continue;
        timer.fn();
      }
      await Promise.resolve();
      await Promise.resolve();
    },
    pending: () => timers.size,
  };
}

function hookCtx({
  runId = 'run-1',
  sessionKey = 'agent:main:discord:channel:123',
  channel = 'discord',
  chatId = '123',
  trigger = 'user',
} = {}) {
  return { runId, sessionKey, sessionId: 'session-1', channel, chatId, channelId: chatId, trigger };
}

function beforeEvent(accountId = 'default') {
  return { accountId };
}

assert.deepEqual(resolveEnforcementConfig({}), {
  mode: 'hybrid',
  autoStartMessage: enforcementDefaults.DEFAULT_AUTO_START_MESSAGE,
  autoWaitAfterMs: 15_000,
  autoWaitMessage: enforcementDefaults.DEFAULT_AUTO_WAIT_MESSAGE,
  turnStateMaxEntries: 1_000,
  turnStateTtlMs: 600_000,
  turnToolTimerMaxEntries: 64,
});
assert.equal(resolveEnforcementConfig({ autoWaitAfterMs: 0 }).autoWaitAfterMs, 0);
assert.equal(resolveEnforcementConfig({ autoWaitAfterMs: 1 }).autoWaitAfterMs, 5_000);
assert.equal(resolveEnforcementConfig({ autoWaitAfterMs: 999_999 }).autoWaitAfterMs, 60_000);
assert.equal(resolveEnforcementConfig({ turnStateMaxEntries: 1 }).turnStateMaxEntries, 100);
assert.equal(resolveEnforcementConfig({ turnStateTtlMs: 1 }).turnStateTtlMs, 60_000);
assert.equal(resolveEnforcementConfig({ turnToolTimerMaxEntries: 0 }).turnToolTimerMaxEntries, 1);
assert.match(buildPromptGuidance({ enforcementMode: 'hybrid' }), /initial progress-card attempt/);
assert.equal(buildPromptGuidance({ enforcementMode: 'off' }), '');

assert.deepEqual(resolveAutomaticRoute(beforeEvent(), hookCtx()), {
  channel: 'discord',
  to: 'channel:123',
  accountId: 'default',
  threadId: null,
});
assert.deepEqual(resolveAutomaticRoute(beforeEvent('secondary'), hookCtx({
  sessionKey: 'agent:main:discord:secondary:direct:42',
  chatId: '42',
})), {
  channel: 'discord',
  to: 'user:42',
  accountId: 'secondary',
  threadId: null,
});
assert.deepEqual(resolveAutomaticRoute(beforeEvent(), hookCtx({
  sessionKey: 'agent:main:discord:channel:123:thread:456',
  chatId: '123:thread:456',
})), {
  channel: 'discord',
  to: 'channel:123',
  accountId: 'default',
  threadId: '456',
});
assert.deepEqual(resolveAutomaticRoute(beforeEvent(), hookCtx({
  sessionKey: 'agent:main:telegram:group:-100:thread:333',
  channel: 'telegram',
  chatId: '-100:thread:333',
})), {
  channel: 'telegram',
  to: '-100',
  accountId: 'default',
  threadId: '333',
});
assert.equal(resolveAutomaticRoute(beforeEvent(), hookCtx({
  sessionKey: 'agent:main:telegram:group:-100:thread:333',
  channel: 'telegram',
  chatId: '-100:thread:444',
})), null);
assert.equal(resolveAutomaticRoute(beforeEvent('default'), hookCtx({
  sessionKey: 'agent:main:discord:secondary:direct:42',
  chatId: '42',
})), null);
assert.equal(resolveAutomaticRoute(beforeEvent(), hookCtx({ trigger: 'cron' })), null);
assert.equal(resolveAutomaticRoute(beforeEvent(), hookCtx({ trigger: 'heartbeat' })), null);
assert.equal(resolveAutomaticRoute({}, hookCtx()), null);
assert.equal(resolveAutomaticRoute(beforeEvent(), hookCtx({ sessionKey: '', chatId: '' })), null);
assert.equal(resolveAutomaticRoute(beforeEvent(), hookCtx({ channel: 'telegram' })), null);
assert.equal(
  resolveAutomaticRoute(beforeEvent(), hookCtx({ sessionKey: 'agent:main:discord:channel:999' })),
  null,
);

const clock = createFakeClock();
const deliveries = [];
const enforcement = createTurnEnforcement({
  deliver: async (request) => {
    deliveries.push(request);
    return { ok: true };
  },
  now: clock.now,
  setTimeoutFn: clock.setTimeoutFn,
  clearTimeoutFn: clock.clearTimeoutFn,
});

const privateEvent = new Proxy({ accountId: 'default' }, {
  get(target, property) {
    if (['prompt', 'messages', 'systemPrompt'].includes(String(property))) {
      throw new Error(`conversation content was accessed: ${String(property)}`);
    }
    return Reflect.get(target, property);
  },
});

const [first, duplicate] = await Promise.all([
  enforcement.start({ event: privateEvent, ctx: hookCtx(), pluginConfig: {} }),
  enforcement.start({ event: privateEvent, ctx: hookCtx(), pluginConfig: {} }),
]);
assert.equal(deliveries.length, 1);
assert.ok([first, duplicate].some((result) => result.attempted));
assert.ok([first, duplicate].some((result) => result.reason === 'already-claimed'));
assert.equal(deliveries[0].message, enforcementDefaults.DEFAULT_AUTO_START_MESSAGE);
assert.equal(deliveries[0].ctx.deliveryContext.to, 'channel:123');
assert.equal(deliveries[0].ctx.deliveryContext.accountId, 'default');
assert.equal('prompt' in deliveries[0].ctx, false);
assert.equal('messages' in deliveries[0].ctx, false);

const routeConflict = await enforcement.start({
  event: beforeEvent('secondary'),
  ctx: hookCtx(),
  pluginConfig: {},
});
assert.equal(routeConflict.reason, 'route-conflict');

const topicRouteOwner = createTurnEnforcement({ deliver: async () => {} });
const topicFirst = await topicRouteOwner.start({
  event: beforeEvent(),
  ctx: hookCtx({
    runId: 'topic-run',
    sessionKey: 'agent:main:telegram:group:-100:thread:333',
    channel: 'telegram',
    chatId: '-100:thread:333',
  }),
});
const topicConflict = await topicRouteOwner.start({
  event: beforeEvent(),
  ctx: hookCtx({
    runId: 'topic-run',
    sessionKey: 'agent:main:telegram:group:-100:thread:444',
    channel: 'telegram',
    chatId: '-100:thread:444',
  }),
});
assert.equal(topicFirst.attempted, true);
assert.equal(topicConflict.reason, 'route-conflict', 'one run cannot change Telegram topics');
topicRouteOwner.clear();

await enforcement.start({ event: beforeEvent(), ctx: hookCtx({ runId: 'run-2' }), pluginConfig: {} });
assert.equal(deliveries.length, 2, 'consecutive runs in one session must both send');

const promptOnly = await enforcement.start({
  event: beforeEvent(),
  ctx: hookCtx({ runId: 'run-prompt' }),
  pluginConfig: { enforcementMode: 'prompt' },
});
assert.equal(promptOnly.attempted, false);
assert.equal(deliveries.length, 2);

const missingRun = await enforcement.start({
  event: beforeEvent(),
  ctx: hookCtx({ runId: '' }),
  pluginConfig: {},
});
assert.equal(missingRun.reason, 'unsafe-route-or-run');

const toolConfig = { autoWaitAfterMs: 5_000 };
assert.equal(enforcement.beforeTool({
  event: { toolName: 'exec', toolCallId: 'fast-1', runId: 'run-1' },
  ctx: { runId: 'run-1' },
  pluginConfig: toolConfig,
}), true);
assert.equal(enforcement.afterTool({
  event: { toolName: 'exec', toolCallId: 'fast-1', runId: 'run-1' },
  ctx: { runId: 'run-1' },
  pluginConfig: toolConfig,
}), true);
await clock.advance(5_000);
assert.equal(deliveries.length, 2, 'fast tools must cancel the waiting card');

assert.equal(enforcement.beforeTool({
  event: { toolName: 'exec', toolCallId: 'slow-1', runId: 'run-1' },
  ctx: { runId: 'run-1' },
  pluginConfig: toolConfig,
}), true);
await clock.advance(5_000);
assert.equal(deliveries.length, 3);
assert.equal(deliveries[2].kind, 'wait');

assert.equal(enforcement.beforeTool({
  event: { toolName: 'exec', toolCallId: 'slow-2', runId: 'run-1' },
  ctx: { runId: 'run-1' },
  pluginConfig: toolConfig,
}), false, 'only one automatic waiting card is allowed per run');
assert.equal(enforcement.beforeTool({
  event: { toolName: 'status_update_ui', toolCallId: 'status-1', runId: 'run-2' },
  ctx: { runId: 'run-2' },
  pluginConfig: toolConfig,
}), false, 'the status tool must not schedule a wait card for itself');

const multiClock = createFakeClock();
const multiDeliveries = [];
const multi = createTurnEnforcement({
  deliver: async (request) => { multiDeliveries.push(request); },
  now: multiClock.now,
  setTimeoutFn: multiClock.setTimeoutFn,
  clearTimeoutFn: multiClock.clearTimeoutFn,
});
await multi.start({ event: beforeEvent(), ctx: hookCtx({ runId: 'multi' }), pluginConfig: toolConfig });
multi.beforeTool({ event: { toolName: 'a', toolCallId: 'a', runId: 'multi' }, ctx: { runId: 'multi' }, pluginConfig: toolConfig });
multi.beforeTool({ event: { toolName: 'b', toolCallId: 'b', runId: 'multi' }, ctx: { runId: 'multi' }, pluginConfig: toolConfig });
await multiClock.advance(5_000);
assert.equal(multiDeliveries.filter((item) => item.kind === 'wait').length, 1);

const timerCapClock = createFakeClock();
const timerCap = createTurnEnforcement({
  deliver: async () => {},
  now: timerCapClock.now,
  setTimeoutFn: timerCapClock.setTimeoutFn,
  clearTimeoutFn: timerCapClock.clearTimeoutFn,
});
await timerCap.start({ event: beforeEvent(), ctx: hookCtx({ runId: 'timer-cap' }) });
const timerCapConfig = { autoWaitAfterMs: 5_000, turnToolTimerMaxEntries: 2 };
assert.equal(timerCap.beforeTool({ event: { toolName: 'a', toolCallId: 'a', runId: 'timer-cap' }, ctx: { runId: 'timer-cap' }, pluginConfig: timerCapConfig }), true);
assert.equal(timerCap.beforeTool({ event: { toolName: 'b', toolCallId: 'b', runId: 'timer-cap' }, ctx: { runId: 'timer-cap' }, pluginConfig: timerCapConfig }), true);
assert.equal(timerCap.beforeTool({ event: { toolName: 'c', toolCallId: 'c', runId: 'timer-cap' }, ctx: { runId: 'timer-cap' }, pluginConfig: timerCapConfig }), false);

const progressClock = createFakeClock();
const progressDeliveries = [];
const progress = createTurnEnforcement({
  deliver: async (request) => { progressDeliveries.push(request); },
  now: progressClock.now,
  setTimeoutFn: progressClock.setTimeoutFn,
  clearTimeoutFn: progressClock.clearTimeoutFn,
});
await progress.start({ event: beforeEvent(), ctx: hookCtx({ runId: 'progress-run' }) });
await progressClock.advance(4_000);
assert.equal(progress.noteProgress({ event: { runId: 'progress-run' }, pluginConfig: toolConfig }), true);
progress.beforeTool({ event: { toolName: 'exec', toolCallId: 'after-progress', runId: 'progress-run' }, ctx: { runId: 'progress-run' }, pluginConfig: toolConfig });
await progressClock.advance(4_999);
assert.equal(progressDeliveries.length, 1, 'every new tool must receive the full long-tool threshold');
await progressClock.advance(1);
assert.equal(progressDeliveries.filter((item) => item.kind === 'wait').length, 1);

const agedClock = createFakeClock();
const agedDeliveries = [];
const aged = createTurnEnforcement({
  deliver: async (request) => { agedDeliveries.push(request); },
  now: agedClock.now,
  setTimeoutFn: agedClock.setTimeoutFn,
  clearTimeoutFn: agedClock.clearTimeoutFn,
});
await aged.start({ event: beforeEvent(), ctx: hookCtx({ runId: 'aged-run' }) });
await agedClock.advance(30_000);
aged.beforeTool({ event: { toolName: 'exec', toolCallId: 'new-tool', runId: 'aged-run' }, ctx: { runId: 'aged-run' }, pluginConfig: toolConfig });
await agedClock.advance(4_999);
assert.equal(agedDeliveries.length, 1, 'old turn age must not trigger an immediate wait card');
await agedClock.advance(1);
assert.equal(agedDeliveries.filter((item) => item.kind === 'wait').length, 1);

const capacityClock = createFakeClock();
const capacity = createTurnEnforcement({
  deliver: async () => {},
  now: capacityClock.now,
  setTimeoutFn: capacityClock.setTimeoutFn,
  clearTimeoutFn: capacityClock.clearTimeoutFn,
});
for (let index = 0; index < 100; index += 1) {
  const result = await capacity.start({
    event: beforeEvent(),
    ctx: hookCtx({ runId: `capacity-${index}` }),
    pluginConfig: { turnStateMaxEntries: 100, turnStateTtlMs: 60_000 },
  });
  assert.equal(result.attempted, true);
}
const saturated = await capacity.start({
  event: beforeEvent(),
  ctx: hookCtx({ runId: 'capacity-overflow' }),
  pluginConfig: { turnStateMaxEntries: 100, turnStateTtlMs: 60_000 },
});
assert.equal(saturated.reason, 'capacity');
await capacityClock.advance(60_001);
const afterTtl = await capacity.start({
  event: beforeEvent(),
  ctx: hookCtx({ runId: 'capacity-after-ttl' }),
  pluginConfig: { turnStateMaxEntries: 100, turnStateTtlMs: 60_000 },
});
assert.equal(afterTtl.attempted, true);
assert.ok(capacity.size() <= 100);

const timeoutClock = createFakeClock();
const timeoutEnforcement = createTurnEnforcement({
  deliver: async () => new Promise(() => {}),
  now: timeoutClock.now,
  setTimeoutFn: timeoutClock.setTimeoutFn,
  clearTimeoutFn: timeoutClock.clearTimeoutFn,
  startDeliveryTimeoutMs: 10,
});
const timeoutStart = timeoutEnforcement.start({ event: beforeEvent(), ctx: hookCtx({ runId: 'timeout' }) });
await timeoutClock.advance(10);
assert.equal((await timeoutStart).attempted, true, 'a hung status send must not block the agent run indefinitely');

const failureEnforcement = createTurnEnforcement({
  deliver: async () => { throw new Error('private adapter failure'); },
});
assert.equal((await failureEnforcement.start({
  event: beforeEvent(),
  ctx: hookCtx({ runId: 'delivery-failure' }),
})).attempted, true);

enforcement.clear();
multi.clear();
capacity.clear();
timeoutEnforcement.clear();
failureEnforcement.clear();
timerCap.clear();
progress.clear();
aged.clear();
assert.equal(clock.pending(), 0);

console.log('turn-enforcement tests passed');
