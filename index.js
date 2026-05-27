import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { executeStatusUpdateUi } from "./src/delivery.js";

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
        return await executeStatusUpdateUi({ api, ctx, params });
      },
    }), { name: "status_update_ui" });
  },
});
