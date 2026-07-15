const ORIGINAL_LOCATION_KEY = "ssr-kit:originalLocation";

let originalLocation: string | undefined;

export function setOriginalLocation(url: string): void {
  originalLocation = url;
  try {
    sessionStorage.setItem(ORIGINAL_LOCATION_KEY, url);
  } catch {
    /* private mode */
  }
}

export function getOriginalLocation(): string | undefined {
  if (originalLocation) return originalLocation;
  try {
    const stored = sessionStorage.getItem(ORIGINAL_LOCATION_KEY);
    if (stored) originalLocation = stored;
  } catch {
    /* ignore */
  }
  return originalLocation;
}

export type SessionSeed = {
  publicPath: string;
  pathname: string;
  search: string;
  theme?: string;
  userAgent?: string;
};

let session: SessionSeed | null = null;

export function seedSession(seed: SessionSeed): void {
  session = seed;
  const url = seed.pathname + seed.search;
  if (!getOriginalLocation()) setOriginalLocation(url);
}

export function getSession(): SessionSeed | null {
  return session;
}
