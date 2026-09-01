const DEFAULT_FALLBACK_NAME = "助理";
const DEFAULT_TITLE_TEMPLATE = "{name} 正在處理";
const DEFAULT_PREFIX = "狀態更新：";
const DEFAULT_MAX_LENGTH = 240;
const BOT_NAME_CACHE_TTL_MS = 10 * 60 * 1000;
const botNameCache = new Map();
const SESSION_DELIVERY_PEER_KINDS = new Set(["channel", "group", "direct", "dm"]);
const USER_PREFIXED_DIRECT_TARGET_CHANNELS = new Set([
  "discord",
  "mattermost",
  "msteams",
  "slack",
]);

export function normalizeText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function clampLength(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function parseSessionKeyRoute(sessionKey) {
  if (typeof sessionKey !== "string") return null;
  const trimmed = sessionKey.trim();
  if (!trimmed) return null;
  const threadMarker = ":thread:";
  const threadMarkerIndex = trimmed.toLowerCase().lastIndexOf(threadMarker);
  let baseSessionKey = trimmed;
  let threadId = null;
  if (threadMarkerIndex !== -1) {
    threadId = trimmed.slice(threadMarkerIndex + threadMarker.length).trim();
    if (!threadId) return null;
    baseSessionKey = trimmed.slice(0, threadMarkerIndex);
  }

  const parts = baseSessionKey.split(":");
  if (parts[0] !== "agent" || !parts[1] || parts.length < 5) return null;

  const channel = parts[2]?.trim().toLowerCase();
  const routeParts = parts.slice(3);

  let accountId = null;
  let peerKind;
  let peerParts;
  if (routeParts.length >= 3 && ["direct", "dm"].includes(routeParts[1]?.toLowerCase())) {
    accountId = routeParts[0]?.trim() || null;
    peerKind = routeParts[1].toLowerCase();
    peerParts = routeParts.slice(2);
  } else {
    peerKind = routeParts[0]?.toLowerCase();
    peerParts = routeParts.slice(1);
  }

  if (!channel || !SESSION_DELIVERY_PEER_KINDS.has(peerKind)) return null;
  const peerId = peerParts.join(":").trim();
  if (!peerId) return null;
  const to = channel === "discord" && ["channel", "group"].includes(peerKind)
    ? `channel:${peerId}`
    : ["direct", "dm"].includes(peerKind) && USER_PREFIXED_DIRECT_TARGET_CHANNELS.has(channel)
      ? `user:${peerId}`
      : peerId;
  return {
    channel,
    to,
    accountId,
    threadId,
  };
}

export function resolveRoute(ctx) {
  const dc = ctx?.deliveryContext ?? {};
  const parsed = parseSessionKeyRoute(ctx?.sessionKey);
  let channel = typeof dc.channel === "string" && dc.channel.trim()
    ? dc.channel.trim()
    : typeof ctx?.messageChannel === "string" && ctx.messageChannel.trim()
      ? ctx.messageChannel.trim()
      : typeof ctx?.channel === "string" && ctx.channel.trim()
        ? ctx.channel.trim()
        : typeof ctx?.messageProvider === "string" && ctx.messageProvider.trim()
          ? ctx.messageProvider.trim()
      : undefined;
  let to = typeof dc.to === "string" && dc.to.trim()
    ? dc.to.trim()
    : typeof ctx?.chatId === "string" && ctx.chatId.trim()
      ? ctx.chatId.trim()
      : typeof ctx?.channelId === "string" && ctx.channelId.trim()
        ? ctx.channelId.trim()
        : undefined;

  if (!channel || !to) {
    if (parsed) {
      if (!channel) channel = parsed.channel;
      if (!to) to = parsed.to;
    }
  }

  if (!channel || !to) return null;
  return {
    channel,
    to,
    accountId: typeof dc.accountId === "string" && dc.accountId.trim()
      ? dc.accountId.trim()
      : typeof ctx?.accountId === "string" && ctx.accountId.trim()
        ? ctx.accountId.trim()
        : parsed?.accountId ?? null,
    threadId: dc.threadId ?? ctx?.threadId ?? parsed?.threadId ?? null,
  };
}

export function firstNonEmpty(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return "";
}

export function applyTitleTemplate(template, name) {
  const cleanTemplate = normalizeText(template) || DEFAULT_TITLE_TEMPLATE;
  const cleanName = normalizeText(name) || DEFAULT_FALLBACK_NAME;
  if (cleanTemplate.includes("{name}")) return cleanTemplate.replaceAll("{name}", cleanName);
  return cleanTemplate;
}

export function buildWorkingTitle(name, template = DEFAULT_TITLE_TEMPLATE) {
  return applyTitleTemplate(template, name);
}

export function resolveContextIdentityName(ctx, api) {
  return firstNonEmpty(
    ctx?.deliveryContext?.botName,
    ctx?.deliveryContext?.botUsername,
    ctx?.deliveryContext?.identity?.displayName,
    ctx?.deliveryContext?.identity?.name,
    ctx?.identity?.displayName,
    ctx?.identity?.name,
    ctx?.agent?.identity?.displayName,
    ctx?.agent?.identity?.name,
    ctx?.agentName,
    api?.config?.identity?.displayName,
    api?.config?.identity?.name,
  );
}

function plainTokenCandidate(value) {
  if (typeof value !== "string") return "";
  const token = normalizeText(value);
  if (!token || token.includes("[object Object]")) return "";
  return token.startsWith("Bot ") ? token.slice(4).trim() : token;
}

export function readPlainDiscordToken(cfg, accountId, env = process.env) {
  const discord = cfg?.channels?.discord;
  const accountToken = accountId
    ? discord?.accounts?.[accountId]?.token
    : undefined;
  return firstNonEmpty(
    plainTokenCandidate(accountToken),
    plainTokenCandidate(discord?.token),
    plainTokenCandidate(env.DISCORD_BOT_TOKEN),
    plainTokenCandidate(env.DISCORD_TOKEN),
  );
}

export async function resolveDiscordBotName({ cfg, accountId, fetchImpl = globalThis.fetch, env = process.env }) {
  const cacheKey = accountId || "default";
  const cached = botNameCache.get(cacheKey);
  if (cached && Date.now() - cached.at < BOT_NAME_CACHE_TTL_MS) return cached.name;

  try {
    const token = readPlainDiscordToken(cfg, accountId, env);
    if (!token || typeof fetchImpl !== "function") return "";

    const res = await fetchImpl("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res?.ok) return "";

    const data = await res.json();
    const name = firstNonEmpty(data?.global_name, data?.username);
    if (name) botNameCache.set(cacheKey, { name, at: Date.now() });
    return name;
  } catch {
    return "";
  }
}

export async function resolveStatusTitle({ pluginConfig = {}, route = {}, ctx, api, cfg, fetchImpl, env }) {
  const configuredTitle = normalizeText(pluginConfig.title);
  if (configuredTitle) return configuredTitle;

  const titleTemplate = normalizeText(pluginConfig.titleTemplate) || DEFAULT_TITLE_TEMPLATE;

  const contextName = resolveContextIdentityName(ctx, api);
  if (contextName) return buildWorkingTitle(contextName, titleTemplate);

  if (route.channel === "discord") {
    const discordName = await resolveDiscordBotName({ cfg, accountId: route.accountId, fetchImpl, env });
    if (discordName) return buildWorkingTitle(discordName, titleTemplate);
  }

  return buildWorkingTitle(pluginConfig.fallbackName || DEFAULT_FALLBACK_NAME, titleTemplate);
}

export function buildFallbackText({ title, prefix = DEFAULT_PREFIX, body }) {
  const line = body.startsWith(prefix) ? body : `${prefix}${body}`;
  return [
    `🦾 **${title}**`,
    `> ${line}`,
  ].join("\n");
}

export function buildPresentation({ fallbackText }) {
  return {
    tone: "info",
    blocks: [
      { type: "text", text: fallbackText },
    ],
  };
}

export const defaults = {
  DEFAULT_FALLBACK_NAME,
  DEFAULT_TITLE_TEMPLATE,
  DEFAULT_PREFIX,
  DEFAULT_MAX_LENGTH,
};

export function clearBotNameCacheForTest() {
  botNameCache.clear();
}
