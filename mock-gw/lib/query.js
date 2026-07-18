export function parsePage(searchParams) {
  return boundedInteger(searchParams.get("page"), 1, 1, 500);
}

export function parsePageSize(searchParams, fallback = 12) {
  return boundedInteger(searchParams.get("pageSize"), fallback, 1, 50);
}

export function paginate(items, page, pageSize) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const normalizedPage = Math.min(page, totalPages);
  const start = (normalizedPage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pagination: {
      page: normalizedPage,
      pageSize,
      total,
      totalPages,
      hasPrevious: normalizedPage > 1,
      hasNext: normalizedPage < totalPages,
    },
  };
}

export function normalizedQuery(value) {
  return (value ?? "").trim().toLocaleLowerCase("tr-TR").slice(0, 120);
}

export function matchesQuery(query, ...values) {
  if (!query) return true;
  return values.some((value) => value.toLocaleLowerCase("tr-TR").includes(query));
}

export function enumParam(searchParams, name, allowed, fallback) {
  const value = searchParams.get(name);
  return value && allowed.has(value) ? value : fallback;
}

export function numberParam(searchParams, name, fallback, min, max) {
  const value = Number(searchParams.get(name));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
