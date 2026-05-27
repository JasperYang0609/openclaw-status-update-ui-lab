import {
  buildFallbackText,
  buildPresentation,
  clampLength,
  defaults,
  normalizeText,
  resolveRoute,
  resolveStatusTitle,
} from "./core.js";

async function sendUiStatus({ adapter, cfg, route, text, presentation, silent }) {
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

function toolText(text, isError = false) {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

export async function executeStatusUpdateUi({ api, ctx, params }) {
  const pluginConfig = api?.pluginConfig ?? {};
  const prefix = normalizeText(pluginConfig.prefix || defaults.DEFAULT_PREFIX) || defaults.DEFAULT_PREFIX;
  const maxLength = Number.isFinite(pluginConfig.maxLength)
    ? Math.max(40, Math.min(1000, Number(pluginConfig.maxLength)))
    : defaults.DEFAULT_MAX_LENGTH;
  const silent = typeof pluginConfig.silent === "boolean" ? pluginConfig.silent : true;
  const style = pluginConfig.style === "text" ? "text" : "presentation";

  const body = clampLength(normalizeText(params?.message), maxLength);
  if (!body) return toolText("status_update_ui failed: message is empty.", true);

  const route = resolveRoute(ctx);
  if (!route) return toolText("status_update_ui failed: no current delivery route is available.", true);

  let adapter;
  try {
    adapter = await api.runtime.channel.outbound.loadAdapter(route.channel);
  } catch {
    return toolText(`status_update_ui failed: channel '${route.channel}' adapter could not be loaded.`, true);
  }

  if (!adapter?.sendText) {
    return toolText(`status_update_ui failed: channel '${route.channel}' does not expose sendText.`, true);
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
    try {
      result = await adapter.sendText({
        cfg,
        to: route.to,
        text: fallbackText,
        accountId: route.accountId,
        threadId: route.threadId,
        silent,
      });
    } catch {
      return toolText("status_update_ui failed: text fallback send failed.", true);
    }
  }

  const messageId = result?.messageId ?? result?.id;
  return toolText(messageId
    ? `status_update_ui sent (${route.channel}, message ${messageId}).`
    : `status_update_ui sent (${route.channel}).`);
}
