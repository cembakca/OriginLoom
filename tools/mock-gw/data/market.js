const companies = [
  ["THYAO", "Türk Hava Yolları", "Ulaştırma", 312.5, 431_250_000_000],
  ["GARAN", "Garanti BBVA", "Bankacılık", 128.4, 539_280_000_000],
  ["AKBNK", "Akbank", "Bankacılık", 71.25, 370_500_000_000],
  ["ISCTR", "İş Bankası (C)", "Bankacılık", 15.82, 395_500_000_000],
  ["YKBNK", "Yapı Kredi", "Bankacılık", 34.16, 288_560_000_000],
  ["KCHOL", "Koç Holding", "Holding", 226.2, 573_780_000_000],
  ["SAHOL", "Sabancı Holding", "Holding", 112.7, 236_670_000_000],
  ["TUPRS", "Tüpraş", "Enerji", 193.6, 373_090_000_000],
  ["EREGL", "Ereğli Demir Çelik", "Metal", 31.48, 220_360_000_000],
  ["BIMAS", "BİM Mağazalar", "Perakende", 548.5, 332_990_000_000],
  ["ASELS", "Aselsan", "Savunma", 89.75, 409_260_000_000],
  ["FROTO", "Ford Otosan", "Otomotiv", 1_082, 379_680_000_000],
  ["TOASO", "Tofaş", "Otomotiv", 312.75, 156_380_000_000],
  ["SISE", "Şişecam", "Cam", 46.9, 143_650_000_000],
  ["TCELL", "Turkcell", "Telekomünikasyon", 106.8, 234_960_000_000],
  ["ENKAI", "Enka İnşaat", "İnşaat", 68.4, 410_400_000_000],
  ["PETKM", "Petkim", "Petrokimya", 22.7, 57_520_000_000],
  ["PGSUS", "Pegasus", "Ulaştırma", 256.75, 128_380_000_000],
  ["MGROS", "Migros", "Perakende", 612, 110_810_000_000],
  ["ULKER", "Ülker Bisküvi", "Gıda", 184.4, 68_110_000_000],
];

export const bist100Stocks = companies.map(
  ([symbol, name, sector, lastPrice, marketCap], index) => {
    const changePercent = Number((((index % 7) - 3) * 0.47 + 0.18).toFixed(2));
    const previousClose = Number((lastPrice / (1 + changePercent / 100)).toFixed(2));
    return {
      symbol,
      name,
      sector,
      lastPrice,
      previousClose,
      change: Number((lastPrice - previousClose).toFixed(2)),
      changePercent,
      dayLow: Number((lastPrice * 0.982).toFixed(2)),
      dayHigh: Number((lastPrice * 1.021).toFixed(2)),
      volume: 4_500_000 + index * 1_275_000,
      marketCap,
      currency: "TRY",
    };
  },
);
