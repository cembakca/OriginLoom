# OriginLoom migration kayıtları

Her platform sürümü için bir belge bulunur. Belge değişikliğin nedenini, otomatik ve manuel
adımları, rollback yolunu ve doğrulama komutlarını içerir.

Bir migration şu özellikleri taşır:

- Benzersiz, değiştirilmeyen id
- Hangi tooling sürümünde geldiği
- Desteklenen en eski kaynak template sürümü
- Dry-run çıktısı
- Otomatik değiştirilen dosyaların kesin listesi
- Kullanıcı koduna dokunan manuel adımlar
- Idempotence ve N-1 yükseltme testi

Uygulama kaynaklarını yeni template ile topluca karşılaştırıp overwrite etmek migration değildir.
Generated dosyalar ilk üretimden sonra uygulamaya aittir.
