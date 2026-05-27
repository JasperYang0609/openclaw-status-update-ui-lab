import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
const DEFAULT_TITLE = "OpenClaw 正在處理";
const DEFAULT_PREFIX = "狀態更新：";
const DEFAULT_MAX_LENGTH = 240;
const BOT_NAME_CACHE_TTL_MS = 10 * 60 * 1000;
const botNameCache = new Map();

function normalizeText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampLength(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function resolveRoute(ctx) {
  const dc = ctx?.deliveryContext ?? {};
  const channel = typeof dc.channel === "string" && dc.channel.trim()
    ? dc.channel.trim()
    : typeof ctx?.messageChannel === "string" && ctx.messageChannel.trim()
      ? ctx.messageChannel.trim()
      : undefined;
  const to = typeof dc.to === "string" && dc.to.trim() ? dc.to.trim() : undefined;
  if (!channel || !to) return null;
  return {
    channel,
    to,
    accountId: typeof dc.accountId === "string" && dc.accountId.trim() ? dc.accountId.trim() : null,
    threadId: dc.threadId ?? null,
  };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return "";
}

function buildWorkingTitle(name) {
  const clean = normalizeText(name);
  return clean ? `${clean} 正在處理` : DEFAULT_TITLE;
}

function resolveContextIdentityName(ctx, api) {
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

function readPlainDiscordToken(cfg, accountId) {
  const discord = cfg?.channels?.discord;
  const accountToken = accountId
    ? discord?.accounts?.[accountId]?.token
    : undefined;
  const token = firstNonEmpty(
    accountToken,
    discord?.token,
    process.env.DISCORD_BOT_TOKEN,
    process.env.DISCORD_TOKEN,
  );
  return token.startsWith("Bot ") ? token.slice(4).trim() : token;
}

async function resolveDiscordBotName({ cfg, accountId }) {
  const cacheKey = accountId || "default";
  const cached = botNameCache.get(cacheKey);
  if (cached && Date.now() - cached.at < BOT_NAME_CACHE_TTL_MS) return cached.name;

  try {
    const token = readPlainDiscordToken(cfg, accountId);
    if (!token) return "";

    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) return "";

    const data = await res.json();
    const name = firstNonEmpty(data?.global_name, data?.username);
    if (name) botNameCache.set(cacheKey, { name, at: Date.now() });
    return name;
  } catch {
    return "";
  }
}

async function resolveStatusTitle({ pluginConfig, route, ctx, api, cfg }) {
  const configuredTitle = normalizeText(pluginConfig.title);
  if (configuredTitle) return configuredTitle;

  if (route.channel === "discord") {
    const discordName = await resolveDiscordBotName({ cfg, accountId: route.accountId });
    if (discordName) return buildWorkingTitle(discordName);
  }

  const contextName = resolveContextIdentityName(ctx, api);
  if (contextName) return buildWorkingTitle(contextName);

  return DEFAULT_TITLE;
}

function buildFallbackText({ title, prefix, body }) {
  const line = body.startsWith(prefix) ? body : `${prefix}${body}`;
  return [
    `🦾 **${title}**`,
    `> ${line}`,
  ].join("\n");
}

function buildPresentation({ title, body }) {
  return {
    title,
    tone: "info",
    blocks: [
      { type: "text", text: `🦾 ${body}` },
      { type: "context", text: "OpenClaw status update" },
    ],
  };
}

async function sendUiStatus({ adapter, cfg, route, text, presentation, silent }) {
  // Prefer OpenClaw semantic presentation when the channel adapter supports it.
  // If anything fails, the caller will fallback to plain sendText.
  if (adapter?.sendPayload && adapter?.renderPresentation) {
    const payload = { text, presentation };
    const baseCtx = {
      cfg,
      to: route.to,
      text,
      payload,
      accountId: route.accountId,
      threadId: route.threadId,
      silent,
    };
    const rendered = await adapter.renderPresentation({ payload, presentation, ctx: baseCtx }) ?? payload;
    return await adapter.sendPayload({
      cfg,
      to: route.to,
      text: rendered.text ?? text,
      payload: rendered,
      accountId: route.accountId,
      threadId: route.threadId,
      silent,
    });
  }
  return null;
}

export default definePluginEntry({
  id: "status-update-ui-lab",
  name: "Status Update UI Lab",
  description: "Experimental one-shot UI wrapper for status updates.",
  register(api) {
    api.registerTool((ctx) => ({
      name: "status_update_ui",
      description:
        "Send a concise Traditional Chinese progress update as a comfortable one-shot UI card in the current conversation. Do not include chain-of-thought, raw commands, secrets, or sensitive local paths.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["message"],
        properties: {
          message: {
            type: "string",
            minLength: 1,
            description:
              "Short Traditional Chinese status summary. Mention current phase, key blocker/change, and next step when useful. Do not include raw commands, secrets, or chain-of-thought.",
          },
        },
      },
      async execute(_toolCallId, params) {
        const pluginConfig = api.pluginConfig ?? {};
        const prefix = normalizeText(pluginConfig.prefix || DEFAULT_PREFIX) || DEFAULT_PREFIX;
        const maxLength = Number.isFinite(pluginConfig.maxLength)
          ? Math.max(40, Math.min(1000, Number(pluginConfig.maxLength)))
          : DEFAULT_MAX_LENGTH;
        const silent = typeof pluginConfig.silent === "boolean" ? pluginConfig.silent : true;
        const style = pluginConfig.style === "text" ? "text" : "presentation";

        const body = clampLength(normalizeText(params?.message), maxLength);
        if (!body) {
          return {
            content: [{ type: "text", text: "status_update_ui failed: message is empty." }],
            isError: true,
          };
        }

        const route = resolveRoute(ctx);
        if (!route) {
          return {
            content: [{ type: "text", text: "status_update_ui failed: no current delivery route is available." }],
            isError: true,
          };
        }

        const adapter = await api.runtime.channel.outbound.loadAdapter(route.channel);
        if (!adapter?.sendText) {
          return {
            content: [{ type: "text", text: `status_update_ui failed: channel '${route.channel}' does not expose sendText.` }],
            isError: true,
          };
        }

        const cfg = ctx?.getRuntimeConfig?.() ?? ctx?.runtimeConfig ?? ctx?.config ?? api.config;
        const title = await resolveStatusTitle({ pluginConfig, route, ctx, api, cfg });
        const fallbackText = buildFallbackText({ title, prefix, body });
        const presentation = buildPresentation({ title, body });

        let result = null;
        if (style === "presentation") {
          try {
            result = await sendUiStatus({ adapter, cfg, route, text: fallbackText, presentation, silent });
          } catch {
            result = null;
          }
        }

        if (!result) {
          result = await adapter.sendText({
            cfg,
            to: route.to,
            text: fallbackText,
            accountId: route.accountId,
            threadId: route.threadId,
            silent,
          });
        }

        const messageId = result?.messageId ?? result?.id;
        return {
          content: [{
            type: "text",
            text: messageId
              ? `status_update_ui sent (${route.channel}, message ${messageId}).`
              : `status_update_ui sent (${route.channel}).`,
          }],
        };
      },
    }), { name: "status_update_ui" });
  },
});
