import type { CategoryRef, ListingQuery, SortKey } from "@/lib/types";

// Category and product URLs carry the id first, so a renamed item keeps working:
// /c/9975-kompyuternaya-tehnika, /p/251049-kartridzh-hp-...

export function categoryHref(c: Pick<CategoryRef, "id" | "slug">): string {
  return `/c/${c.id}-${c.slug}`;
}

export function productHref(p: { sku: number; slug: string }): string {
  return `/p/${p.sku}-${p.slug}`;
}

/** "9975-kompyuternaya-tehnika" -> 9975 */
export function idFromSlug(slug: string): number | null {
  const id = Number.parseInt(slug, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export const SORTS: Record<SortKey, string> = {
  popular: "Популярные",
  price_asc: "Сначала дешёвые",
  price_desc: "Сначала дорогие",
  new: "Новинки",
  name: "По названию",
};

export const PER_PAGE = 24;

type RawSearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function positive(v: string | string[] | undefined): number | undefined {
  const n = Number(first(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseListing(sp: RawSearchParams, base: Partial<ListingQuery> = {}): ListingQuery {
  const vendor = sp.vendor;
  const sort = first(sp.sort);
  return {
    ...base,
    vendors: (Array.isArray(vendor) ? vendor : vendor ? [vendor] : []).filter(Boolean).sort(),
    sort: sort && sort in SORTS ? (sort as SortKey) : "popular",
    page: Math.min(Math.max(Math.trunc(positive(sp.page) ?? 1), 1), 1000),
  };
}

/** URL query of a listing page (category/search are part of the path or `q`). */
export function listingSearch(query: ListingQuery, patch: Partial<ListingQuery> = {}): string {
  const q = { ...query, ...patch };
  const sp = new URLSearchParams();
  if (q.q) sp.set("q", q.q);
  for (const v of q.vendors) sp.append("vendor", v);
  if (q.sort !== "popular") sp.set("sort", q.sort);
  if (q.page > 1) sp.set("page", String(q.page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
