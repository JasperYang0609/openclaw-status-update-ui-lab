import {
  buildFallbackText,
  buildPresentation,
  clampLength,
  defaults,
  normalizeText,
  resolveRoute,
  resolveStatusTitle,
} from "./core.js";
import {
  buildAttemptKey,
  createDeliveryGuard,
  resolveGuardConfig,
  resolveSessionIdentity,
} from "./delivery-guard.js";

const deliveryGuard = createDeliveryGuard();

async function renderUiStatus({ adapter, cfg, route, presentation, silent }) {
  if (adapter?.sendPayload && adapter?.renderPresentation) {
    // For rich presentation, keep the visible content in one presentation block only.
    // Passing fallback text as payload.text makes Discord render duplicate blocks.
    const payload = { text: "", presentation };
    const baseCtx = {
      cfg,
      to: route.to,
      text: "",
      payload,
      accountId: route.accountId,
      threadId: route.threadId,
      silent,
    };
    return await adapter.renderPresentation({ payload, presentation, ctx: baseCtx }) ?? payload;
  }
  return null;
}

async function dispatchPayload({ adapter, cfg, route, rendered, silent }) {
  return await adapter.sendPayload({
    cfg,
    to: route.to,
    text: rendered.text ?? "",
    payload: rendered,
    accountId: route.accountId,
    threadId: route.threadId,
    silent,
  });
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

  const guardConfig = resolveGuardConfig(pluginConfig);
  const attemptKey = buildAttemptKey({
    route,
    sessionIdentity: resolveSessionIdentity(ctx),
    message: body,
  });
  const claim = deliveryGuard.acquire(attemptKey, guardConfig);
  if (claim.saturated) {
    return toolText(
      `status_update_ui delivery guard is busy; no message was sent (attempt ${claim.attemptId}).`,
      true,
    );
  }
  if (claim.suppressed) {
    return toolText(`status_update_ui suppressed a recent duplicate (${claim.state}, attempt ${claim.attemptId}).`);
  }

  let adapter;
  try {
    adapter = await api.runtime.channel.outbound.loadAdapter(route.channel);
  } catch {
    deliveryGuard.release(attemptKey);
    return toolText(`status_update_ui failed: channel '${route.channel}' adapter could not be loaded.`, true);
  }

  if (!adapter?.sendText) {
    deliveryGuard.release(attemptKey);
    return toolText(`status_update_ui failed: channel '${route.channel}' does not expose sendText.`, true);
  }

  const cfg = ctx?.getRuntimeConfig?.() ?? ctx?.runtimeConfig ?? ctx?.config ?? api.config;
  const title = await resolveStatusTitle({ pluginConfig, route, ctx, api, cfg });
  const fallbackText = buildFallbackText({ title, prefix, body });
  const presentation = buildPresentation({ fallbackText });

  let result = null;
  if (style === "presentation") {
    let rendered = null;
    try {
      rendered = await renderUiStatus({ adapter, cfg, route, presentation, silent });
    } catch {
      // Rendering happens before platform I/O, so a plain-text fallback is safe.
      rendered = null;
    }

    if (rendered) {
      deliveryGuard.mark(attemptKey, "dispatching", guardConfig);
      try {
        result = await dispatchPayload({ adapter, cfg, route, rendered, silent });
      } catch {
        deliveryGuard.mark(attemptKey, "unknown", guardConfig);
        return toolText(
          `status_update_ui delivery outcome is unknown; it may already be visible, so no fallback was sent (attempt ${claim.attemptId}).`,
          true,
        );
      }
      if (!result) {
        deliveryGuard.mark(attemptKey, "unknown", guardConfig);
        return toolText(
          `status_update_ui delivery outcome is unknown because no delivery result was returned; no fallback was sent (attempt ${claim.attemptId}).`,
          true,
        );
      }
    }
  }

  if (!result) {
    deliveryGuard.mark(attemptKey, "dispatching", guardConfig);
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
      deliveryGuard.mark(attemptKey, "unknown", guardConfig);
      return toolText(
        `status_update_ui delivery outcome is unknown; it may already be visible, so no retry was attempted (attempt ${claim.attemptId}).`,
        true,
      );
    }
  }

  const messageId = result?.messageId ?? result?.id;
  if (!messageId) {
    deliveryGuard.mark(attemptKey, "unknown", guardConfig);
    return toolText(
      `status_update_ui delivery outcome is unknown because no message identity was returned (attempt ${claim.attemptId}).`,
      true,
    );
  }
  deliveryGuard.mark(attemptKey, "confirmed", guardConfig);
  return toolText(messageId
    ? `status_update_ui sent (${route.channel}, message ${messageId}).`
    : `status_update_ui sent (${route.channel}).`);
}

export function clearDeliveryGuardForTest() {
  deliveryGuard.clear();
}
