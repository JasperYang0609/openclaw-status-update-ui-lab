import { createHash, randomUUID } from "node:crypto";

const DEFAULT_DEDUPE_WINDOW_MS = 30_000;
const DEFAULT_GUARD_MAX_ENTRIES = 1_000;
const MIN_DEDUPE_WINDOW_MS = 1_000;
const MAX_DEDUPE_WINDOW_MS = 120_000;
const MIN_GUARD_MAX_ENTRIES = 100;
const MAX_GUARD_MAX_ENTRIES = 10_000;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function resolveGuardConfig(pluginConfig = {}) {
  return {
    dedupeWindowMs: boundedInteger(
      pluginConfig.dedupeWindowMs,
      DEFAULT_DEDUPE_WINDOW_MS,
      MIN_DEDUPE_WINDOW_MS,
      MAX_DEDUPE_WINDOW_MS,
    ),
    guardMaxEntries: boundedInteger(
      pluginConfig.guardMaxEntries,
      DEFAULT_GUARD_MAX_ENTRIES,
      MIN_GUARD_MAX_ENTRIES,
      MAX_GUARD_MAX_ENTRIES,
    ),
  };
}

export function resolveSessionIdentity(ctx) {
  const candidates = [
    ctx?.sessionKey,
    ctx?.deliveryContext?.sessionKey,
    ctx?.runId,
    ctx?.taskId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

export function buildAttemptKey({ route, sessionIdentity, message }) {
  if (!sessionIdentity) return "";
  const source = JSON.stringify({
    accountId: route?.accountId ?? "",
    channel: route?.channel ?? "",
    to: route?.to ?? "",
    threadId: route?.threadId ?? "",
    sessionIdentity,
    message,
  });
  return createHash("sha256").update(source).digest("hex");
}

export function createDeliveryGuard() {
  const entries = new Map();

  function cleanupExpired(now) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
  }

  function enforceCapacity(maxEntries) {
    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    acquire(key, { now = Date.now(), dedupeWindowMs, guardMaxEntries } = {}) {
      if (!key) return { tracked: false, attemptId: randomUUID() };
      cleanupExpired(now);
      const existing = entries.get(key);
      if (existing && existing.expiresAt > now) {
        return {
          tracked: true,
          suppressed: true,
          attemptId: existing.attemptId,
          state: existing.state,
        };
      }
      enforceCapacity(guardMaxEntries);
      const entry = {
        attemptId: randomUUID(),
        state: "prepared",
        expiresAt: now + dedupeWindowMs,
      };
      entries.set(key, entry);
      return { tracked: true, suppressed: false, attemptId: entry.attemptId };
    },

    mark(key, state) {
      if (!key) return;
      const entry = entries.get(key);
      if (entry) entry.state = state;
    },

    release(key) {
      if (key) entries.delete(key);
    },

    clear() {
      entries.clear();
    },

    size() {
      return entries.size;
    },
  };
}

export const deliveryGuardDefaults = {
  DEFAULT_DEDUPE_WINDOW_MS,
  DEFAULT_GUARD_MAX_ENTRIES,
};
