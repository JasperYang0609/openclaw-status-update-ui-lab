import { executeStatusUpdateUi } from "./delivery.js";
import { buildPromptGuidance, createTurnEnforcement } from "./turn-enforcement.js";

export function registerStatusUpdateUiPlugin(api) {
  const enforcement = createTurnEnforcement({
    deliver: async ({ ctx, message }) => executeStatusUpdateUi({ api, ctx, params: { message } }),
  });

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
      const result = await executeStatusUpdateUi({ api, ctx, params });
      if (!result?.isError) enforcement.noteProgress({ ctx, pluginConfig: api.pluginConfig });
      return result;
    },
  }), { name: "status_update_ui" });

  api.on("before_agent_run", async (event, ctx) => {
    try {
      await enforcement.start({ event, ctx, pluginConfig: api.pluginConfig });
    } catch {
      // This conversation hook is fail-closed in OpenClaw, so always contain
      // plugin failures and explicitly pass the normal agent run.
    }
    return { outcome: "pass" };
  });

  api.on("before_prompt_build", (_event, _ctx) => {
    const guidance = buildPromptGuidance(api.pluginConfig);
    return guidance ? { appendSystemContext: guidance } : undefined;
  });

  api.on("before_tool_call", (event, ctx) => {
    try {
      enforcement.beforeTool({ event, ctx, pluginConfig: api.pluginConfig });
    } catch {
      // Status instrumentation must never block the underlying tool call.
    }
  });

  api.on("after_tool_call", (event, ctx) => {
    try {
      enforcement.afterTool({ event, ctx, pluginConfig: api.pluginConfig });
    } catch {
      // Status instrumentation must never alter the tool result.
    }
  });
}
