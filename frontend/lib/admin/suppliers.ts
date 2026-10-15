import type { Audience, PaymentMethod, PriceType } from "@/lib/admin/types";

// The suppliers whose catalogs the shop imports (backend/app/pricing.py: SUPPLIERS). Static, so the nav lists
// them without a request; the supplier page reads the names and product counts from the API.
export const SUPPLIERS = [{ code: "itp", name: "IT Partner", url: "https://b2b.i-t-p.pro" }] as const;
export const DEFAULT_SUPPLIER = "itp";

// Every supplier has its own way of delivering the catalog: the loading page belongs to the supplier. Only
// IT Partner's exists so far (backend/app/api/admin/loading.py).
const WITH_LOADING: ReadonlySet<string> = new Set(["itp"]);

export function supplierName(code: string): string | null {
  return SUPPLIERS.find((s) => s.code === code)?.name ?? null;
}

/** The sections of a supplier's page: its prices and, if it has one, its catalog loading. */
export function supplierSections(code: string): { href: string; label: string }[] {
  const base = `/admin/suppliers/${code}`;
  return [{ href: base, label: "Цены" }, ...(WITH_LOADING.has(code) ? [{ href: `${base}/loading`, label: "Загрузка каталога" }] : [])];
}

export function hasLoading(code: string): boolean {
  return WITH_LOADING.has(code);
}

export type PriceTypeInfo = { value: PriceType; label: string; short: string; audience: Audience; payment: PaymentMethod };

/** The 4 prices of a product, each computed by its own markup rules: organizations pay the wholesale ones, private
 * persons the retail ones («Физ. лица»), each for cash or cashless. */
export const PRICE_TYPES: PriceTypeInfo[] = [
  { value: "wholesale_cash", label: "Опт · наличные", short: "Опт нал", audience: "wholesale", payment: "cash" },
  { value: "wholesale_cashless", label: "Опт · безнал", short: "Опт безнал", audience: "wholesale", payment: "cashless" },
  { value: "retail_cash", label: "Физ. лица · наличные", short: "Физ. нал", audience: "retail", payment: "cash" },
  { value: "retail_cashless", label: "Физ. лица · безнал", short: "Физ. безнал", audience: "retail", payment: "cashless" },
];

export const PRICE_TYPE = Object.fromEntries(PRICE_TYPES.map((t) => [t.value, t])) as Record<PriceType, PriceTypeInfo>;

export function priceType(audience: Audience, payment: PaymentMethod): PriceType {
  return `${audience}_${payment}`;
}

/** One of the types the admin panel edits (PRICE_TYPES). */
export function isPriceType(v: unknown): v is PriceType {
  return PRICE_TYPES.some((t) => t.value === v);
}
