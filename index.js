import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  buildFallbackText,
  buildPresentation,
  clampLength,
  defaults,
  normalizeText,
  resolveRoute,
  resolveStatusTitle,
} from "./src/core.js";

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
        const prefix = normalizeText(pluginConfig.prefix || defaults.DEFAULT_PREFIX) || defaults.DEFAULT_PREFIX;
        const maxLength = Number.isFinite(pluginConfig.maxLength)
          ? Math.max(40, Math.min(1000, Number(pluginConfig.maxLength)))
          : defaults.DEFAULT_MAX_LENGTH;
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
