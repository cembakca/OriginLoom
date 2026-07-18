export function seoInfo({
  title,
  description,
  path,
  image = "/assets/media/og-default.jpg",
  imageAlt = title,
  noindex = false,
  nofollow = false,
  openGraphType = "website",
  publishedTime,
  modifiedTime,
  author,
  section,
  tags,
}) {
  return withoutUndefined({
    title,
    metaDescription: description,
    headingTitle: title,
    image,
    imageAlt,
    imageWidth: 1200,
    imageHeight: 630,
    friendlyUrl: path,
    noindex,
    nofollow,
    openGraphType,
    publishedTime,
    modifiedTime,
    author,
    section,
    tags,
  });
}

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
