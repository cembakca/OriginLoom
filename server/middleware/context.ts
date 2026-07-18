export type RequestClass = "api" | "proxy" | "ssr";

export type AppVariables = {
  requestId: string;
  clientIp?: string;
  cspNonce?: string;
  request?: Request;
  requestClass?: RequestClass;
  requestRoute?: string;
};
