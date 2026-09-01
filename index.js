import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerStatusUpdateUiPlugin } from "./src/plugin.js";

export { registerStatusUpdateUiPlugin } from "./src/plugin.js";

export default definePluginEntry({
  id: "status-update-ui-lab",
  name: "Status Update UI Lab",
  description: "Runtime-enforced one-shot UI status cards for channel turns.",
  register: registerStatusUpdateUiPlugin,
});
