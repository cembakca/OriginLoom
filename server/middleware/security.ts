import { secureHeaders } from "hono/secure-headers";

export const securityMiddleware = secureHeaders({
  xContentTypeOptions: "nosniff",
  xFrameOptions: "DENY",
  referrerPolicy: "strict-origin-when-cross-origin",
});
