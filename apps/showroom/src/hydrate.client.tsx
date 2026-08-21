import { createIslandMounter, type IslandModule } from "@originloom/react/lib/client/island-mount";

export const mount = createIslandMounter({
  modules: import.meta.glob<IslandModule>("./islands/*.tsx"),
  // App-owned copy — the platform never bakes a locale-specific string into the island
  // runtime itself (see OR2 in CACHE_PERFORMANCE_ROADMAP.md).
  formatIslandError: ({ errorId }) => `Bir sorun oluştu. Referans: ${errorId}`,
});
