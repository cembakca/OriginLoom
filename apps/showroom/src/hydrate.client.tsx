import { createIslandMounter, type IslandModule } from "@originloom/react/lib/client/island-mount";

export const mount = createIslandMounter({
  modules: import.meta.glob<IslandModule>("./islands/*.tsx"),
});
