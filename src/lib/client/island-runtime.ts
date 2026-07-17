export const ISLAND_MOUNT_TIMEOUT_MS = 10_000;
export const ISLAND_CHUNK_RETRY_DELAY_MS = 250;

export type IslandRuntimeFailure = "chunk-load" | "mount-timeout";

export class IslandRuntimeError extends Error {
  constructor(
    readonly failure: IslandRuntimeFailure,
    options?: ErrorOptions,
  ) {
    super(
      failure === "mount-timeout"
        ? "Island mount exceeded its bootstrap timeout"
        : "Island chunk could not be loaded",
      options,
    );
    this.name = "IslandRuntimeError";
  }
}

type LoadPolicy = {
  timeoutMs?: number;
  retryDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
};

type BootstrapPolicy = {
  onObserverError?: (error: unknown) => void;
  observer?: typeof IntersectionObserver | null;
};

export function createIslandMountWatchdog(
  onTimeout: () => void,
  timeoutMs = ISLAND_MOUNT_TIMEOUT_MS,
): () => void {
  const timer = setTimeout(onTimeout, timeoutMs);
  return () => clearTimeout(timer);
}

/**
 * Load one island chunk under a total time budget. A single retry is allowed only for transient
 * module-fetch failures while the document is visible and the browser is online.
 */
export async function loadIslandModule<T>(
  load: () => Promise<T>,
  policy: LoadPolicy = {},
): Promise<T> {
  const timeoutMs = policy.timeoutMs ?? ISLAND_MOUNT_TIMEOUT_MS;
  const retryDelayMs = policy.retryDelayMs ?? ISLAND_CHUNK_RETRY_DELAY_MS;
  const shouldRetry = policy.shouldRetry ?? isTransientChunkLoadError;
  const deadline = Date.now() + timeoutMs;

  try {
    return await withinDeadline(load, deadline);
  } catch (error) {
    if (error instanceof IslandRuntimeError && error.failure === "mount-timeout") throw error;
    if (!shouldRetry(error)) throw new IslandRuntimeError("chunk-load", { cause: error });
  }

  await delayWithinDeadline(retryDelayMs, deadline);
  try {
    return await withinDeadline(load, deadline);
  } catch (error) {
    if (error instanceof IslandRuntimeError && error.failure === "mount-timeout") throw error;
    throw new IslandRuntimeError("chunk-load", { cause: error });
  }
}

/**
 * Eager roots always start before observer setup. If the API is absent, its constructor is
 * overridden, or observe() throws, every lazy island falls back to immediate mounting.
 */
export function bootstrapIslandElements(
  elements: Iterable<HTMLElement>,
  mount: (element: HTMLElement) => void,
  policy: BootstrapPolicy = {},
): void {
  const roots = Array.from(elements);
  const started = new WeakSet<HTMLElement>();
  const start = (element: HTMLElement) => {
    if (started.has(element)) return;
    started.add(element);
    mount(element);
  };

  const lazy: HTMLElement[] = [];
  for (const element of roots) {
    if (element.dataset.eager !== undefined) start(element);
    else lazy.push(element);
  }
  if (lazy.length === 0) return;

  let observer: IntersectionObserver | undefined;
  try {
    const Observer =
      policy.observer === undefined ? globalThis.IntersectionObserver : policy.observer;
    if (typeof Observer !== "function") {
      for (const element of lazy) start(element);
      return;
    }

    observer = new Observer(
      (entries, current) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          current.unobserve(entry.target);
          start(entry.target as HTMLElement);
        }
      },
      { rootMargin: "200px" },
    );
    for (const element of lazy) observer.observe(element);
  } catch (error) {
    observer?.disconnect();
    policy.onObserverError?.(error);
    for (const element of lazy) start(element);
  }
}

export function isTransientChunkLoadError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;

  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === "ChunkLoadError" ||
    (error instanceof TypeError &&
      /failed to fetch|dynamically imported module|importing a module script|module script/i.test(
        message,
      ))
  );
}

async function withinDeadline<T>(load: () => Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new IslandRuntimeError("mount-timeout");

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new IslandRuntimeError("mount-timeout")), remaining);
  });
  try {
    return await Promise.race([Promise.resolve().then(load), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function delayWithinDeadline(delayMs: number, deadline: number): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= delayMs) throw new IslandRuntimeError("mount-timeout");
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
