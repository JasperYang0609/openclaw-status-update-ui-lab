import { parseSessionKeyRoute, resolveRoute } from "./core.js";

const DEFAULT_ENFORCEMENT_MODE = "hybrid";
const DEFAULT_AUTO_START_MESSAGE = "狀態更新：已收到任務，正在確認範圍並開始處理。";
const DEFAULT_AUTO_WAIT_AFTER_MS = 15_000;
const DEFAULT_AUTO_WAIT_MESSAGE = "狀態更新：目前仍在等待這個步驟完成；完成後會立即驗證結果並繼續。";
const DEFAULT_TURN_STATE_MAX_ENTRIES = 1_000;
const DEFAULT_TURN_STATE_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_TURN_TOOL_TIMER_MAX_ENTRIES = 64;
const DEFAULT_START_DELIVERY_TIMEOUT_MS = 4_000;
const STATIC_SYSTEM_GUIDANCE = [
  "Status Update UI Lab runtime handles the initial progress-card attempt for eligible channel turns.",
  "Do not duplicate that initial card. Use status_update_ui only for meaningful phase, blocker, strategy, verification, or recovery changes.",
  "Keep status cards concise and never include hidden reasoning, raw commands, secrets, sensitive paths, or private message content.",
  "The final answer must remain an ordinary assistant reply, not a status card.",
].join(" ");

function boundedInteger(value, fallback, min, max, { allowZero = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (allowZero && parsed === 0) return 0;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function nonEmptyString(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeTargetForComparison(value) {
  const text = nonEmptyString(value);
  const separator = text.indexOf(":");
  if (separator === -1) return text;
  const prefix = text.slice(0, separator).toLowerCase();
  if (["channel", "chat", "direct", "dm", "group", "thread", "user"].includes(prefix)) {
    return text.slice(separator + 1);
  }
  return text;
}

function splitTarget(value) {
  const normalized = normalizeTargetForComparison(value);
  const markerIndex = normalized.lastIndexOf(":thread:");
  if (markerIndex === -1) return { base: normalized, threadId: null };
  return {
    base: normalized.slice(0, markerIndex),
    threadId: normalized.slice(markerIndex + 8) || null,
  };
}

function sameRoute(left, right) {
  const leftTarget = splitTarget(left?.to);
  const rightTarget = splitTarget(right?.to);
  return Boolean(
    left
    && right
    && left.channel === right.channel
    && leftTarget.base === rightTarget.base
    && (left.accountId ?? null) === (right.accountId ?? null)
    && (left.threadId ?? leftTarget.threadId ?? null) === (right.threadId ?? rightTarget.threadId ?? null),
  );
}

function safeRunId(event, ctx) {
  return nonEmptyString(ctx?.runId) || nonEmptyString(event?.runId);
}

export function resolveEnforcementConfig(pluginConfig = {}) {
  const mode = ["off", "prompt", "hybrid"].includes(pluginConfig.enforcementMode)
    ? pluginConfig.enforcementMode
    : DEFAULT_ENFORCEMENT_MODE;
  return {
    mode,
    autoStartMessage: nonEmptyString(pluginConfig.autoStartMessage, DEFAULT_AUTO_START_MESSAGE),
    autoWaitAfterMs: boundedInteger(
      pluginConfig.autoWaitAfterMs,
      DEFAULT_AUTO_WAIT_AFTER_MS,
      5_000,
      60_000,
      { allowZero: true },
    ),
    autoWaitMessage: nonEmptyString(pluginConfig.autoWaitMessage, DEFAULT_AUTO_WAIT_MESSAGE),
    turnStateMaxEntries: boundedInteger(
      pluginConfig.turnStateMaxEntries,
      DEFAULT_TURN_STATE_MAX_ENTRIES,
      100,
      10_000,
    ),
    turnStateTtlMs: boundedInteger(
      pluginConfig.turnStateTtlMs,
      DEFAULT_TURN_STATE_TTL_MS,
      60_000,
      3_600_000,
    ),
    turnToolTimerMaxEntries: boundedInteger(
      pluginConfig.turnToolTimerMaxEntries,
      DEFAULT_TURN_TOOL_TIMER_MAX_ENTRIES,
      1,
      1_000,
    ),
  };
}

export function buildPromptGuidance(pluginConfig = {}) {
  const { mode } = resolveEnforcementConfig(pluginConfig);
  return mode === "off" ? "" : STATIC_SYSTEM_GUIDANCE;
}

export function resolveAutomaticRoute(event = {}, ctx = {}) {
  if (ctx?.trigger !== "user") return null;

  const accountId = nonEmptyString(event?.accountId);
  if (!accountId) return null;

  const explicitChannel = nonEmptyString(ctx?.channel) || nonEmptyString(ctx?.messageProvider);
  const explicitTarget = nonEmptyString(ctx?.chatId) || nonEmptyString(ctx?.channelId);

  const explicit = resolveRoute({
    channel: ctx?.channel,
    messageProvider: ctx?.messageProvider,
    chatId: ctx?.chatId,
    channelId: ctx?.channelId,
    accountId: event?.accountId,
  });
  const parsed = parseSessionKeyRoute(ctx?.sessionKey);

  if (parsed && explicitChannel && parsed.channel !== explicitChannel) return null;
  if (parsed && parsed.accountId && parsed.accountId !== accountId) return null;
  if (parsed && explicitTarget) {
    const parsedTarget = splitTarget(parsed.to);
    const explicitTargetParts = splitTarget(explicitTarget);
    if (parsedTarget.base !== explicitTargetParts.base) return null;
    if (explicitTargetParts.threadId && explicitTargetParts.threadId !== parsed.threadId) return null;
  }
  if (parsed && explicit) {
    if (parsed.channel !== explicit.channel) return null;
    if (splitTarget(parsed.to).base !== splitTarget(explicit.to).base) return null;
    const explicitThreadId = explicit.threadId ?? splitTarget(explicit.to).threadId;
    if (explicitThreadId && explicitThreadId !== parsed.threadId) return null;
  }

  const base = parsed ?? explicit;
  if (!base) return null;
  return {
    channel: base.channel,
    to: base.to,
    accountId,
    threadId: parsed?.threadId ?? base.threadId ?? splitTarget(base.to).threadId,
  };
}

function deliveryContextFor({ event, ctx, route }) {
  return {
    runId: safeRunId(event, ctx),
    sessionKey: nonEmptyString(ctx?.sessionKey),
    sessionId: nonEmptyString(ctx?.sessionId),
    channel: route.channel,
    chatId: route.to,
    channelId: route.to,
    messageProvider: ctx?.messageProvider,
    trigger: ctx?.trigger,
    identity: ctx?.identity,
    agent: ctx?.agent,
    agentName: ctx?.agentName,
    deliveryContext: {
      channel: route.channel,
      to: route.to,
      accountId: route.accountId,
      threadId: route.threadId,
      runId: safeRunId(event, ctx),
      sessionKey: nonEmptyString(ctx?.sessionKey),
      sessionId: nonEmptyString(ctx?.sessionId),
    },
  };
}

function settleWithin(promise, timeoutMs, setTimeoutFn, clearTimeoutFn) {
  let timeoutHandle;
  const timed = new Promise((resolve) => {
    timeoutHandle = setTimeoutFn(() => resolve({ timedOut: true }), timeoutMs);
  });
  const guarded = Promise.resolve(promise)
    .then((value) => ({ timedOut: false, value }))
    .catch(() => ({ timedOut: false, failed: true }));
  return Promise.race([guarded, timed]).finally(() => clearTimeoutFn(timeoutHandle));
}

export function createTurnEnforcement({
  deliver,
  now = () => Date.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  startDeliveryTimeoutMs = DEFAULT_START_DELIVERY_TIMEOUT_MS,
} = {}) {
  if (typeof deliver !== "function") throw new TypeError("deliver must be a function");
  const entries = new Map();

  function cancelEntryTimers(entry) {
    for (const handle of entry.toolTimers.values()) clearTimeoutFn(handle);
    entry.toolTimers.clear();
  }

  function cleanupExpired(currentNow = now()) {
    for (const [runId, entry] of entries) {
      if (entry.expiresAt <= currentNow) {
        cancelEntryTimers(entry);
        entries.delete(runId);
      }
    }
  }

  function touch(entry, config, currentNow = now()) {
    entry.expiresAt = currentNow + config.turnStateTtlMs;
  }

  function getEntry(runId, config) {
    cleanupExpired();
    const entry = entries.get(runId);
    if (entry) touch(entry, config);
    return entry;
  }

  async function start({ event = {}, ctx = {}, pluginConfig = {} } = {}) {
    const config = resolveEnforcementConfig(pluginConfig);
    if (config.mode !== "hybrid") return { attempted: false, reason: config.mode };

    const runId = safeRunId(event, ctx);
    const route = resolveAutomaticRoute(event, ctx);
    if (!runId || !route) return { attempted: false, reason: "unsafe-route-or-run" };

    cleanupExpired();
    const existing = entries.get(runId);
    if (existing) {
      return {
        attempted: false,
        reason: sameRoute(existing.route, route) ? "already-claimed" : "route-conflict",
      };
    }
    if (entries.size >= config.turnStateMaxEntries) {
      return { attempted: false, reason: "capacity" };
    }

    const currentNow = now();
    const entry = {
      runId,
      route,
      deliveryCtx: deliveryContextFor({ event, ctx, route }),
      startAttempted: true,
      waitSent: false,
      lastProgressAt: currentNow,
      expiresAt: currentNow + config.turnStateTtlMs,
      toolTimers: new Map(),
    };
    entries.set(runId, entry);

    const delivery = deliver({
      ctx: entry.deliveryCtx,
      message: config.autoStartMessage,
      kind: "start",
    });
    await settleWithin(delivery, startDeliveryTimeoutMs, setTimeoutFn, clearTimeoutFn);
    return { attempted: true };
  }

  function noteProgress({ event = {}, ctx = {}, pluginConfig = {} } = {}) {
    const config = resolveEnforcementConfig(pluginConfig);
    const runId = safeRunId(event, ctx);
    if (!runId) return false;
    const entry = getEntry(runId, config);
    if (!entry) return false;
    entry.lastProgressAt = now();
    return true;
  }

  function beforeTool({ event = {}, ctx = {}, pluginConfig = {} } = {}) {
    const config = resolveEnforcementConfig(pluginConfig);
    if (config.mode !== "hybrid" || config.autoWaitAfterMs === 0) return false;
    if (event?.toolName === "status_update_ui") return false;

    const runId = safeRunId(event, ctx);
    const toolCallId = nonEmptyString(event?.toolCallId) || nonEmptyString(ctx?.toolCallId);
    if (!runId || !toolCallId) return false;
    const entry = getEntry(runId, config);
    if (!entry || entry.waitSent || entry.toolTimers.has(toolCallId)) return false;
    if (entry.toolTimers.size >= config.turnToolTimerMaxEntries) return false;

    // A tool always receives the full threshold from its own start. Prior turn
    // age must never make a newly started tool emit an immediate wait card.
    const delay = config.autoWaitAfterMs;
    const ownedRoute = entry.route;
    const handle = setTimeoutFn(() => {
      const latest = entries.get(runId);
      if (!latest || latest !== entry || !sameRoute(latest.route, ownedRoute)) return;
      latest.toolTimers.delete(toolCallId);
      if (latest.waitSent) return;
      latest.waitSent = true;
      latest.lastProgressAt = now();
      touch(latest, config);
      for (const otherHandle of latest.toolTimers.values()) clearTimeoutFn(otherHandle);
      latest.toolTimers.clear();
      Promise.resolve(deliver({
        ctx: latest.deliveryCtx,
        message: config.autoWaitMessage,
        kind: "wait",
      })).catch(() => {});
    }, delay);
    entry.toolTimers.set(toolCallId, handle);
    return true;
  }

  function afterTool({ event = {}, ctx = {}, pluginConfig = {} } = {}) {
    const config = resolveEnforcementConfig(pluginConfig);
    const runId = safeRunId(event, ctx);
    const toolCallId = nonEmptyString(event?.toolCallId) || nonEmptyString(ctx?.toolCallId);
    if (!runId || !toolCallId) return false;
    const entry = getEntry(runId, config);
    const handle = entry?.toolTimers.get(toolCallId);
    if (handle === undefined) return false;
    clearTimeoutFn(handle);
    entry.toolTimers.delete(toolCallId);
    return true;
  }

  function clear() {
    for (const entry of entries.values()) cancelEntryTimers(entry);
    entries.clear();
  }

  return {
    start,
    noteProgress,
    beforeTool,
    afterTool,
    clear,
    size: () => entries.size,
  };
}

export const enforcementDefaults = {
  DEFAULT_ENFORCEMENT_MODE,
  DEFAULT_AUTO_START_MESSAGE,
  DEFAULT_AUTO_WAIT_AFTER_MS,
  DEFAULT_AUTO_WAIT_MESSAGE,
  DEFAULT_TURN_STATE_MAX_ENTRIES,
  DEFAULT_TURN_STATE_TTL_MS,
  DEFAULT_TURN_TOOL_TIMER_MAX_ENTRIES,
  DEFAULT_START_DELIVERY_TIMEOUT_MS,
  STATIC_SYSTEM_GUIDANCE,
};
