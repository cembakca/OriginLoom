/**
 * Deployment assets for the `with-ops` create-app plugin.
 *
 * Implementation is shared with the legacy module path until the file is fully
 * inlined here; the plugin loader always imports through this entry point.
 */
export { renderOpsTemplates } from "../../templates-ops.mjs";
