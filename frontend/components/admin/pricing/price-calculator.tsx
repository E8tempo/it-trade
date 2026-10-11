"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { Field } from "@/components/admin/orders/order-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiErrorText } from "@/lib/admin/errors";
import { money } from "@/lib/admin/labels";
import type { AdminCategory, PricePreview, PricingSettings } from "@/lib/admin/types";
import { api } from "@/lib/api/client";

/** Shows every step of the retail price for a supplier price, with the given (possibly unsaved) rules. */
export function PriceCalculator({ categories, settings }: { categories: AdminCategory[]; settings?: PricingSettings }) {
  const [supplier, setSupplier] = useState("10000");
  const [rrp, setRrp] = useState("");
  const [category, setCategory] = useState<string>("none");
  const [result, setResult] = useState<PricePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const roots = categories.filter((c) => c.depth <= 1);
  const items = { none: "Без категории", ...Object.fromEntries(roots.map((c) => [String(c.id), c.name])) };

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api<PricePreview>("/api/admin/pricing/preview", {
          method: "POST",
          body: JSON.stringify({
            settings: settings ?? null,
            supplier_price: Number(supplier),
            rrp: rrp ? Number(rrp) : null,
            category_id: category === "none" ? null : Number(category),
          }),
        }),
      );
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Закупочная цена, ₽">
          <Input type="number" min={1} value={supplier} onChange={(e) => setSupplier(e.target.value)} className="h-9" />
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
      </div>
      <Button type="button" variant="outline" onClick={run} disabled={busy || !(Number(supplier) > 0)}>
        {busy && <LoaderCircle className="animate-spin" />}
        Посчитать
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && (
        <ol className="space-y-2 rounded-xl bg-muted/50 p-4 text-sm">
          <Step n={1}>
            Наценка <b>{result.markup_percent}%</b>{" "}
            {result.markup_category ? <>— задана для категории «{result.markup_category.name}»</> : <>— общая</>}:{" "}
            {money(Number(supplier))} × {(1 + result.markup_percent / 100).toFixed(3)} = <b>{money(result.by_markup)}</b>
          </Step>
          <Step n={2}>
            Не меньше закупки + минимальной наценки: <b>{money(result.floor)}</b>
          </Step>
          <Step n={3}>
            {result.rrp_used ? (
              <>
                Есть РРЦ поставщика, и она не ниже минимума — берём её: <b>{money(result.before_rounding)}</b>
              </>
            ) : (
              <>
                РРЦ {rrp ? "ниже минимума или выключена в правилах" : "нет"} — остаётся <b>{money(result.before_rounding)}</b>
              </>
            )}
          </Step>
          <Step n={4}>
            Округление вверх: <b className="text-base">{money(result.price)}</b>
          </Step>
          <li className="border-t pt-2 text-muted-foreground">
            Наценка в рублях: {money(result.margin)} ({result.margin_percent}% от закупки)
          </li>
        </ol>
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
