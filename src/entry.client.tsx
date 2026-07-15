import "./styles/globals.css";

import type { ComponentType } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import { AppQueryProvider } from "~/lib/query/provider";

type IslandModule = { default: ComponentType<Record<string, unknown>> };

// Vite turns this into a code-split map. Each island is its own chunk, so a
// page ships only the JS for the islands actually on it.
const registry = import.meta.glob<IslandModule>("./islands/*.tsx");

const byName = new Map<string, () => Promise<IslandModule>>();
for (const [path, load] of Object.entries(registry)) {
  byName.set(path.slice("./islands/".length, -".tsx".length), load);
}

async function mount(el: HTMLElement) {
  const load = byName.get(el.dataset.island!);
  if (!load) return console.warn("[island] not found:", el.dataset.island);
  const { default: Comp } = await load();

  const props = JSON.parse(el.dataset.props || "{}") as Record<string, unknown>;
  const tree = (
    <AppQueryProvider>
      <Comp {...props} />
    </AppQueryProvider>
  );

  if (el.dataset.mode === "hydrate") {
    hydrateRoot(el, tree);
  } else {
    createRoot(el).render(tree);
  }
}

const io = new IntersectionObserver(
  (entries, obs) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      obs.unobserve(e.target);
      void mount(e.target as HTMLElement);
    }
  },
  { rootMargin: "200px" },
);

for (const el of document.querySelectorAll<HTMLElement>("[data-island]")) {
  if (el.dataset.eager !== undefined) void mount(el);
  else io.observe(el);
}
