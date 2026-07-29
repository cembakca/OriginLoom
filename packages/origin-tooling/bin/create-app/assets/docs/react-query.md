# TanStack Query

React template, tarayıcıda yüklenen sunucu verileri için TanStack Query v5 ile gelir. SSR route
loader'ları bunun yerine geçmez: SEO ve ilk HTML için gereken veri route loader'da; kullanıcıya özel,
etkileşimden sonra yenilenen veri ise island içindeki query hook'unda kalır.

## Template'teki çalışan örnek

- `src/hydrate.client.tsx`, her island'ı `AppQueryProvider` ile sarar. Provider bütün island'ların
  aynı browser `QueryClient` örneğini paylaşmasını sağlar.
- `src/lib/query/keys.ts`, query key'lerini merkezi ve tip güvenli tutar.
- `src/lib/query/hooks/use-session.ts`, `/api/session` BFF endpoint'ini `useQuery` ile çağırır.
- `src/islands/account-panel.tsx`, loading, signed-out, error, retry ve success durumlarını gösterir.

Yeni bir query eklerken key'i `keys.ts` içine, fetch fonksiyonu ile hook'u aynı feature klasörüne
ekleyin. Token'ı query key'e veya query sonucuna koymayın; `clientApiFetch` HttpOnly cookie'leri
`credentials: "include"` ile gönderir.

```ts
export function useProductsQuery(category: string) {
  return useQuery({
    queryKey: ["products", { category }],
    queryFn: () => clientApiFetch(`/api/products?category=${encodeURIComponent(category)}`),
  });
}
```

## React Query'yi tamamen kaldırma

Projede client-side server-state ihtiyacı yoksa aşağıdaki adımlar paketi ve runtime provider'ını
tamamen kaldırır.

1. `src/islands/account-panel.tsx` içindeki query kullanan örneği silin veya query kullanmayan bir
   island ile değiştirin:

   ```tsx
   export default function AccountPanel() {
     return <p className="text-sm text-slate-600">Hesap verisi bu projede etkin değil.</p>;
   }
   ```

2. Şu iki app-owned dosyayı silin:

   ```text
   src/lib/query/hooks/use-session.ts
   src/lib/query/keys.ts
   ```

3. `src/hydrate.client.tsx` dosyasından şu import'u kaldırın:

   ```ts
   import { AppQueryProvider } from "@originloom/react/lib/query/provider";
   ```

   Aynı dosyadaki `createIslandMounter` seçeneklerinden şu satırı da kaldırın:

   ```ts
   Wrapper: AppQueryProvider,
   ```

4. Bağımlılığı kaldırın ve lockfile'ı yenileyin:

   ```bash
   pnpm remove @tanstack/react-query
   pnpm install
   ```

5. Kalan import olmadığını ve paketin artık çözülmediğini doğrulayın:

   ```bash
   rg "@tanstack/react-query|AppQueryProvider|useSessionQuery" src
   pnpm why @tanstack/react-query
   pnpm typecheck
   pnpm test
   pnpm build
   ```

`@tanstack/react-query`, `@originloom/react` için optional peer dependency'dir. Bu nedenle provider
ve query import'ları kaldırıldıktan sonra yukarıdaki `pnpm remove` paketi gerçekten dependency
graph'ından çıkarır.
