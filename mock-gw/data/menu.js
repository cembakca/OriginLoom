const headerItems = [
  menuCategory(1, "Kredi", "/ihtiyac-kredisi", [
    menuItem(11, 1, "İhtiyaç Kredisi", "/ihtiyac-kredisi", 1),
    menuItem(12, 1, "Emekli Bankacılığı", "/emekli-bankaciligi", 2, "Emekli"),
  ]),
  menuCategory(2, "Blog", "/blogs/paginated", [
    menuItem(21, 2, "Blog Listesi", "/blogs/paginated", 1),
    menuItem(22, 2, "Blog Listesi Streaming", "/blogs/paginated/streaming", 2, "Blog Streaming"),
    menuItem(23, 2, "Popüler Bloglar (Fragment)", "/blogs/popular-fragments", 3, "Popüler Bloglar"),
  ]),
  menuCategory(3, "Finansal Ürünler", "/konut-kredisi", [
    menuItem(31, 3, "Konut Kredileri", "/konut-kredisi", 1),
    menuItem(32, 3, "Kredi Kartları", "/kredi-kartlari", 2),
    menuItem(
      33,
      3,
      "Kart Başvuru Yönlendirmesi",
      "/basvuru/kredi-karti/maximum/yonlendirme",
      3,
      "Kart Başvurusu",
    ),
  ]),
  menuCategory(4, "Bilgi Merkezi", "/bilgi-merkezi", [
    menuItem(41, 4, "Tüm Finans Rehberleri", "/bilgi-merkezi", 1),
    menuItem(42, 4, "Konut Kredisi Rehberleri", "/bilgi-merkezi?category=konut-kredisi", 2),
    menuItem(43, 4, "Yatırım Rehberleri", "/bilgi-merkezi?category=yatirim", 3),
  ]),
  menuCategory(5, "Piyasalar", "/piyasalar/bist-100", [
    menuItem(51, 5, "BIST 100 Hisseleri", "/piyasalar/bist-100", 1),
  ]),
];

export const menu = {
  headerItems,
  hamburgerItems: headerItems,
  footerItems: [
    footerItem(100, "Hakkımızda", "/hakkimizda", 1),
    footerItem(101, "Gizlilik", "/gizlilik.pdf", 2),
    footerItem(102, "İletişim", "/iletisim", 3),
  ],
};

function menuCategory(id, name, url, subMenuItemList) {
  return {
    id,
    name,
    url,
    displayOrder: id,
    mobileDisplayOrder: id,
    itemType: 4,
    subMenuItemList,
  };
}

function menuItem(id, parentId, name, url, order, hamburgerName) {
  return {
    id,
    parentId,
    name,
    ...(hamburgerName ? { hamburgerName } : {}),
    url,
    displayOrder: order,
    mobileDisplayOrder: order,
    itemType: 4,
  };
}

function footerItem(id, name, url, order) {
  return {
    id,
    name,
    url,
    displayOrder: order,
    mobileDisplayOrder: order,
    itemType: 16,
  };
}
