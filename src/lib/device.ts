/** API `device` header values — backend menu kırılımı. */
export type DeviceType = "Desktop" | "Tablet" | "Mobile";

/** Shell seçimi: Desktop ayrı; Tablet + Mobile → mobile shell (hamburger). */
export type DeviceShell = "desktop" | "mobile";

export function getDeviceType(request: Request): DeviceType {
  const ua = request.headers.get("user-agent") ?? "";
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return "Tablet";
  if (/Android|iPhone|iPod|Mobile|IEMobile|Opera Mini/i.test(ua)) return "Mobile";
  return "Desktop";
}

export function getDeviceShell(device: DeviceType): DeviceShell {
  return device === "Desktop" ? "desktop" : "mobile";
}

/** HTML cache key fragment — shell (header/footer layout) device'a bağlı. */
export function deviceCacheFragment(request: Request): DeviceType {
  return getDeviceType(request);
}

/** @deprecated Use getDeviceType — kept for existing route keys. */
export function device(request: Request): "mobile" | "desktop" {
  return getDeviceShell(getDeviceType(request)) === "mobile" ? "mobile" : "desktop";
}
