import { cacheLife, cacheTag } from "next/cache";

import { ApiError, apiPublic } from "@/lib/api/server";
import type {
  CategoryDetail,
  CategoryNode,
  ListingQuery,
  ProductDetail,
  ProductPage,
  Shop,
} from "@/lib/types";

// Cached catalog reads. Profiles are defined in next.config.ts:
//   structure - categories and shop settings (change rarely)
//   catalog   - products, prices and stock (the backend syncs stock every 30 min)
// Routes without dynamic params call `connection()` before these functions, so nothing is
// fetched at build time (the backend is not reachable from `next build` in Docker).

export async function getCategoryTree(depth?: number): Promise<CategoryNode[]> {
  "use cache";
  cacheLife("structure");
  cacheTag("categories");
  return apiPublic<CategoryNode[]>(`/api/categories${depth ? `?depth=${depth}` : ""}`);
}

export async function getCategory(id: number): Promise<CategoryDetail | null> {
  "use cache";
  cacheLife("structure");
  cacheTag("categories");
  return orNull(apiPublic<CategoryDetail>(`/api/categories/${id}`));
}

export async function getShop(): Promise<Shop> {
  "use cache";
  cacheLife("structure");
  cacheTag("shop");
  return apiPublic<Shop>("/api/shop");
}

type ProductsOptions = {
  perPage?: number;
  withImage?: boolean;
  exclude?: number;
  facets?: boolean;
};

export async function getProducts(query: ListingQuery, options: ProductsOptions = {}): Promise<ProductPage> {
  "use cache";
  cacheLife("catalog");
  cacheTag("products");
  const sp = new URLSearchParams();
  if (query.q) sp.set("q", query.q);
  if (query.category) sp.set("category", String(query.category));
  for (const v of query.vendors) sp.append("vendor", v);
  if (query.min) sp.set("min_price", String(query.min));
  if (query.max) sp.set("max_price", String(query.max));
  sp.set("sort", query.sort);
  sp.set("page", String(query.page));
  sp.set("per_page", String(options.perPage ?? 24));
  if (options.withImage) sp.set("with_image", "true");
  if (options.exclude) sp.set("exclude", String(options.exclude));
  if (options.facets === false) sp.set("facets", "false");
  return apiPublic<ProductPage>(`/api/products?${sp}`);
}

export async function getProduct(sku: number): Promise<ProductDetail | null> {
  "use cache";
  cacheLife("catalog");
  cacheTag("products", `product-${sku}`);
  return orNull(apiPublic<ProductDetail>(`/api/products/${sku}`));
}

async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
