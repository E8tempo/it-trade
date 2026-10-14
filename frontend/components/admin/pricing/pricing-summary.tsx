"use client";

import { roundingLabel } from "@/components/admin/pricing/pricing-editor";
import { Panel } from "@/components/admin/ui";
import { money } from "@/lib/admin/labels";
import { PRICE_TYPES } from "@/lib/admin/suppliers";
import type { PriceRules, PriceType, SupplierPricing } from "@/lib/admin/types";
import { countLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A sample purchase priced by the saved rules of every type (no category, no RRP). */
export type PriceExample = { supplierPrice: number; prices: Record<PriceType, number> | null };

function ownMarkups(r: PriceRules): string {
  const n = Object.keys(r.category_markups).length;
  return n ? countLabel(n, ["категория", "категории", "категорий"]) : "нет";
}

const ROWS: [string, (r: PriceRules) => string][] = [
  ["Наценка по умолчанию", (r) => `${Number(r.markup_percent).toLocaleString("ru-RU")}%`],
  ["Свои наценки категорий", ownMarkups],
  ["Минимальная наценка", (r) => money(r.min_markup)],
  ["Округление вверх", (r) => roundingLabel(r.round_to)],
  ["РРЦ поставщика", (r) => (r.use_rrp ? "ставится" : "не ставится")],
];

/** The saved rules of the 4 price types side by side; a column header opens that type's tab. */
export function PricingSummary({
  pricing,
  example,
  dirty,
  active,
  onSelect,
}: {
  pricing: SupplierPricing;
  example: PriceExample;
  dirty: Record<PriceType, boolean>;
  active: PriceType;
  onSelect: (t: PriceType) => void;
}) {
  const cell = (t: PriceType) => cn("px-3 py-2 text-left", t === active && "bg-muted/60");
  return (
    <Panel title="Сводка">
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr>
              <th className="w-48" />
              {PRICE_TYPES.map((t) => (
                <th key={t.value} scope="col" className={cn(cell(t.value), "rounded-t-lg align-bottom font-medium")}>
                  <button
                    type="button"
                    onClick={() => onSelect(t.value)}
                    className={cn("inline-flex items-center gap-1.5 text-left hover:text-primary", t.value === active && "text-primary")}
                  >
                    {t.label}
                    {dirty[t.value] && (
                      <>
                        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber-500" title="Есть несохранённые изменения" />
                        <span className="sr-only">(есть несохранённые изменения)</span>
                      </>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, value]) => (
              <tr key={label} className="border-t">
                <th scope="row" className="py-2 pr-3 text-left font-normal text-muted-foreground">
                  {label}
                </th>
                {PRICE_TYPES.map((t) => (
                  <td key={t.value} className={cn(cell(t.value), "tabular-nums")}>
                    {value(pricing[t.value])}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-muted-foreground">
                Закупка {money(example.supplierPrice)} →
              </th>
              {PRICE_TYPES.map((t) => (
                <td key={t.value} className={cn(cell(t.value), "rounded-b-lg font-semibold tabular-nums")}>
                  {money(example.prices?.[t.value])}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Сохранённые правила. Пример цены — для товара без своей наценки категории и без РРЦ.
      </p>
    </Panel>
  );
}
