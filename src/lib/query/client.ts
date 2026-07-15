import { QueryClient } from "@tanstack/react-query";

function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

let browserClient: QueryClient | undefined;

/** Island mount'ları arasında paylaşılan singleton (client-only). */
export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    return createAppQueryClient();
  }
  browserClient ??= createAppQueryClient();
  return browserClient;
}
