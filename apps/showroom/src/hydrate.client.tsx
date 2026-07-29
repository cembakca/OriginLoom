import { createIslandMounter, type IslandModule } from "@originloom/react/lib/client/island-mount";
import { AppQueryProvider } from "@originloom/react/lib/query/provider";

export const mount = createIslandMounter({
  modules: import.meta.glob<IslandModule>("./islands/*.tsx"),
  Wrapper: AppQueryProvider,
});
