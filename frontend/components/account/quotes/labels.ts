import type { PriceSource } from "@/lib/types";

export const VAT_RATES = [5, 7, 10, 20, 22];

/** Select items: "none" for «Без НДС». */
export const VAT_ITEMS: Record<string, string> = {
  none: "Без НДС",
  ...Object.fromEntries(VAT_RATES.map((r) => [String(r), `НДС ${r} %`])),
};

export const ROUND_ITEMS: Record<string, string> = {
  "0": "До копеек",
  "1": "До рубля",
  "10": "До 10 ₽",
  "100": "До 100 ₽",
};

export const PRICE_SOURCE: Record<PriceSource, string> = {
  fixed: "своя цена",
  rrp: "по РРЦ",
  markup: "по наценке",
};

/** «КП № 7» */
export function quoteName(n: number): string {
  return `КП № ${n}`;
}
