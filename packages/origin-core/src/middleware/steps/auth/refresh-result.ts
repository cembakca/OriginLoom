export type RefreshResult =
  | { kind: "success"; access: string; refresh: string }
  | { kind: "unauthorized" }
  | { kind: "unavailable" };
