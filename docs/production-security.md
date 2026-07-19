# Production Security Gate ve Runbook

Bu belge “container ayağa kalktı” ile “finans trafiğine açılabilir” arasındaki zorunlu güvenlik kabul
adımlarını tanımlar. `mock-gw` production güvenlik kanıtı değildir; aşağıdaki gateway testleri gerçek
servis ve gerçek ingress topolojisiyle çalıştırılır.

## Trust boundary envanteri

| Yüzey                  | Erişim                                 | Kontrol                                                                            |
| ---------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| Public SSR/BFF `:3005` | Internet → TLS ingress                 | CSP, body/deadline/capacity, explicit BFF route, distributed API limit             |
| Operations `:9090`     | `monitoring` ve `operations` namespace | NetworkPolicy + ayrı bearer secret; public listener'da path'ler `404`              |
| Gateway                | Yalnız server egress                   | HTTPS, runtime payload schema, timeout; wildcard browser proxy yok                 |
| Redis                  | Yalnız server egress                   | `rediss://`, ACL/credential, release namespace; raw client IP/token key'e yazılmaz |

`k8s/ingress.yaml` ve `k8s/network-policy.yaml` örnektir. Cluster'ın gerçek ingress class'ı, namespace
adları, proxy CIDR'ları ve TLS secret'ı deploy öncesinde uyarlanır. Network plugin'inin NetworkPolicy
uyguladığı ayrıca doğrulanır.

## Release gate

Production deploy aşağıdakiler tamamlanmadan onaylanmaz:

1. `npm run ci`, `npm run audit:prod`, Trivy ve CodeQL başarılı.
2. Image digest ile deploy edilir; registry imzası/provenance ve SBOM release kaydına bağlanır.
3. Secret manager gerçek `REDIS_URL`, operations token'ları, market token ve auth coordination
   anahtarını enjekte eder; manifestteki placeholder değerlerle startup denenmez.
4. Public ingress'ten `/metrics`, cache purge ve referral stats istekleri `404`; operations Service
   üzerinden doğru token ile `200`, yanlış token ile `401` verir.
5. `X-Forwarded-For` spoof testi yapılır: izinli ingress dışındaki socket peer rate-limit kimliğini
   değiştiremez. `TRUSTED_PROXY_CIDRS` cluster ağının tamamı değil mümkün olan en dar ingress ağıdır.
6. CSP staging'de enforce edilir; asset/image CDN, GTM, island hydration ve form submit için sıfır
   beklenmeyen violation ile browser smoke tamamlanır.
7. Referral ve auth mutation'ında cross-site/missing-origin istekleri `403`; limit aşımı `429 +
Retry-After` verir. Kredi hesaplama ve SSE için yük/admission testi yapılır.
8. Gerçek gateway contract/fault testleri `400/401`, `403`, `429`, `5xx`, timeout, connection reset ve
   malformed/oversized payload sınıflarını kapsar. `5xx` sırasında auth cookie'sinin silinmediği
   browser üzerinden doğrulanır.
9. Staging DAST ve bağımsız pentest bulgularında açık Critical/High kalmaz. Finansal mutation, ödeme
   veya kişisel veri eklendiğinde tehdit modeli ve pentest yeniden açılır.
10. Alert route, on-call sahibi, log/trace retention ve rollback tatbikatı kayıt altındadır.

## Secret rotation

- `CACHE_PURGE_SECRET`, `REFERRAL_STATS_SECRET` ve `MARKET_STREAM_TOKEN` sağlayıcı prosedürüyle
  rotate edilir; eski değer iptal edilmeden yeni değerle health/operations smoke tamamlanır.
- Auth coordination için yeni değer `AUTH_REFRESH_COORDINATION_SECRET`, eski değer
  `AUTH_REFRESH_COORDINATION_PREVIOUS_SECRET` olarak deploy edilir. Bütün pod'lar yeni key ile yazmaya
  başladıktan ve en az coordination TTL geçtiğinden emin olunca previous değer kaldırılır.
- Secret değerleri URL query, log, metric label, trace attribute, client bundle veya incident ticket'a
  yazılmaz.

## Incident kararları

| Olay                        | İlk aksiyon                                                                                    | Kaçınılacak davranış                      |
| --------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| CSP gerçek trafiği kesiyor  | İhlal kaynağını doğrula; gerekirse süreli `CSP_ENFORCE=false` rollback                         | Kalıcı wildcard source eklemek            |
| Redis kesintisi             | Gateway/render saturation'ı izle; ingress trafiğini sınırla veya readiness politikasını uygula | Pod-local HTML cache'e sessiz düşmek      |
| Gateway `5xx`               | Circuit/traffic azaltma, stale/public davranışı izle                                           | Kullanıcı cookie'lerini geçersiz saymak   |
| Operations token sızıntısı  | Secret'ı rotate et, operations audit loglarını incele, NetworkPolicy erişimini daralt          | Yalnız URL path'ini gizli kabul etmek     |
| Şüpheli referral otomasyonu | Ürün/IP hızlarını incele, edge kuralını daralt, gerekirse ilgili product flow'u durdur         | Client sayacını authoritative kabul etmek |

Incident sonrasında request ID/trace ile timeline çıkarılır, etkilenen release digest'i korunur ve
kalıcı düzeltme için test eklenmeden olay kapatılmaz.
