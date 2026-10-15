"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { Field } from "@/components/admin/orders/order-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiErrorText } from "@/lib/admin/errors";
import { money } from "@/lib/admin/labels";
import { DEFAULT_SUPPLIER, PRICE_TYPE, PRICE_TYPES } from "@/lib/admin/suppliers";
import type { AdminCategory, PricePreview, PriceRules, PriceType } from "@/lib/admin/types";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const TYPES = Object.fromEntries(PRICE_TYPES.map((t) => [t.value, t.label]));

// the inputs the result was computed for: they may be edited after that
type Result = { preview: PricePreview; type: PriceType; supplierPrice: number; rrp: boolean };

/**
 * Shows every step of a price for a supplier price, with the given (possibly unsaved) rules of `priceType`,
 * and what the same purchase costs at the other price types. Without `priceType` the type is picked here.
 */
export function PriceCalculator({
  categories,
  settings,
  priceType,
  supplier = DEFAULT_SUPPLIER,
  disabled,
}: {
  categories: AdminCategory[];
  settings?: PriceRules;
  priceType?: PriceType;
  supplier?: string;
  disabled?: boolean; // the rules being tried are not valid
}) {
  const [picked, setPicked] = useState<PriceType>(PRICE_TYPES[0].value);
  const [supplierPrice, setSupplierPrice] = useState("10000");
  const [rrp, setRrp] = useState("");
  const [category, setCategory] = useState<string>("none");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const type = priceType ?? picked;

  const roots = categories.filter((c) => c.depth <= 1);
  const items = { none: "Без категории", ...Object.fromEntries(roots.map((c) => [String(c.id), c.name])) };

  async function run() {
    const cost = Number(supplierPrice);
    setBusy(true);
    setError(null);
    try {
      const preview = await api<PricePreview>("/api/admin/pricing/preview", {
        method: "POST",
        body: JSON.stringify({
          supplier,
          price_type: type,
          settings: settings ?? null,
          supplier_price: cost,
          rrp: rrp ? Number(rrp) : null,
          category_id: category === "none" ? null : Number(category),
        }),
      });
      setResult({ preview, type, supplierPrice: cost, rrp: !!rrp });
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  const r = result?.preview;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Закупочная цена, ₽">
          <Input type="number" min={1} value={supplierPrice} onChange={(e) => setSupplierPrice(e.target.value)} className="h-9" />
        </Field>
        <Field label="РРЦ поставщика, ₽">
          <Input type="number" min={1} value={rrp} onChange={(e) => setRrp(e.target.value)} placeholder="нет" className="h-9" />
        </Field>
        <Field label="Категория" className="col-span-2">
          <Select items={items} value={category} onValueChange={(v) => v && setCategory(v)}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value="none">Без категории</SelectItem>
              {roots.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.depth === 1 ? `— ${c.name}` : c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {!priceType && (
          <Field label="Цена" className="col-span-2">
            <Select items={TYPES} value={picked} onValueChange={(v) => v && setPicked(v as PriceType)}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>
      <Button type="button" variant="outline" onClick={run} disabled={busy || disabled || !(Number(supplierPrice) > 0)}>
        {busy && <LoaderCircle className="animate-spin" />}
        Посчитать
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && r && (
        <div className="space-y-3 rounded-xl bg-muted/50 p-4 text-sm">
          {!priceType && <p className="font-medium">{PRICE_TYPE[result.type].label}</p>}
          <ol className="space-y-2">
            <Step n={1}>
              Наценка <b>{r.markup_percent}%</b>{" "}
              {r.markup_category ? <>— задана для категории «{r.markup_category.name}»</> : <>— общая</>}:{" "}
              {money(result.supplierPrice)} × {(1 + r.markup_percent / 100).toFixed(3)} = <b>{money(r.by_markup)}</b>
            </Step>
            <Step n={2}>
              Не меньше закупки + минимальной наценки: <b>{money(r.floor)}</b>
            </Step>
            <Step n={3}>
              {r.rrp_used ? (
                <>
                  Есть РРЦ поставщика, и она не ниже минимума — берём её: <b>{money(r.before_rounding)}</b>
                </>
              ) : (
                <>
                  РРЦ {result.rrp ? "ниже минимума или выключена в правилах" : "нет"} — остаётся <b>{money(r.before_rounding)}</b>
                </>
              )}
            </Step>
            <Step n={4}>
              Округление вверх: <b className="text-base">{money(r.price)}</b>
            </Step>
            <li className="border-t pt-2 text-muted-foreground">
              Наценка в рублях: {money(r.margin)} ({r.margin_percent}% от закупки)
            </li>
          </ol>
          {r.by_type && (
            <div className="border-t pt-3">
              <p className="mb-2 text-muted-foreground">Та же закупка по всем ценам:</p>
              <dl className="grid grid-cols-2 gap-2">
                {PRICE_TYPES.map((t) => (
                  <div key={t.value} className={cn("rounded-lg bg-background px-3 py-2", t.value === result.type && "ring-1 ring-primary/40")}>
                    <dt className="text-xs text-muted-foreground">{t.label}</dt>
                    <dd className="font-medium tabular-nums">{money(r.by_type[t.value])}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-medium text-primary">{n}</span>
      <span>{children}</span>
    </li>
  );
}
