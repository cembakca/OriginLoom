import type { PreparedRequest } from "./prepared-request.js";

export type RequestClass = "api" | "proxy" | "ssr";

export type AppVariables = {
  requestId: string;
  clientIp?: string;
  cspNonce?: string;
  request?: Request;
  requestClass?: RequestClass;
  requestRoute?: string;
  preparedRequest?: PreparedRequest;
};
