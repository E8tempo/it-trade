"use client";

import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DELIVERY, money } from "@/lib/admin/labels";
import type { AdminProduct, DeliveryMethod, Page, PriceType } from "@/lib/admin/types";
import { api } from "@/lib/api/client";
import { useDebounced } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export type Line = {
  sku: number;
  name: string;
  price: number;
  qty: number;
  supplier_price: number | null;
  prices?: AdminProduct["prices"]; // catalog prices of a line picked in this form, to follow a change of the price type
};

export type Customer = {
  customer_name: string;
  phone: string;
  email: string;
  delivery: DeliveryMethod;
  city: string;
  address: string;
  comment: string;
};

export function CustomerFields({ value, onChange, disabled }: { value: Customer; onChange: (v: Customer) => void; disabled?: boolean }) {
  const set = (patch: Partial<Customer>) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Имя покупателя">
        <Input required value={value.customer_name} onChange={(e) => set({ customer_name: e.target.value })} disabled={disabled} className="h-9" />
      </Field>
      <Field label="Телефон">
        <Input required type="tel" value={value.phone} onChange={(e) => set({ phone: e.target.value })} disabled={disabled} className="h-9" placeholder="+7 978 000-00-00" />
      </Field>
      <Field label="E-mail">
        <Input type="email" value={value.email} onChange={(e) => set({ email: e.target.value })} disabled={disabled} className="h-9" />
      </Field>
      <Field label="Получение">
        <Select items={DELIVERY} value={value.delivery} onValueChange={(v) => v && set({ delivery: v as DeliveryMethod })} disabled={disabled}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(DELIVERY).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {value.delivery !== "pickup" && (
        <>
          <Field label="Город">
            <Input value={value.city} onChange={(e) => set({ city: e.target.value })} disabled={disabled} className="h-9" placeholder="Симферополь" />
          </Field>
          <Field label="Адрес">
            <Input value={value.address} onChange={(e) => set({ address: e.target.value })} disabled={disabled} className="h-9" />
          </Field>
        </>
      )}
      <Field label="Комментарий покупателя" className="sm:col-span-2">
        <Textarea value={value.comment} onChange={(e) => set({ comment: e.target.value })} disabled={disabled} rows={2} />
      </Field>
    </div>
  );
}

/** A labelled form control: the <label> wraps the control, so they are associated without ids. */
export function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-sm font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * Order lines: quantity and unit price per line, products added from the catalog search at their price of
 * `priceType` (the order's audience and payment method).
 */
export function ItemsEditor({
  lines,
  onChange,
  priceType,
  disabled,
}: {
  lines: Line[];
  onChange: (l: Line[]) => void;
  priceType: PriceType;
  disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const add = (p: AdminProduct) => {
    const existing = lines.findIndex((l) => l.sku === p.sku);
    if (existing >= 0) update(existing, { qty: lines[existing].qty + 1 });
    else
      onChange([
        ...lines,
        { sku: p.sku, name: p.name, price: p.prices[priceType] ?? 0, qty: 1, supplier_price: p.supplier_price, prices: p.prices },
      ]);
  };

  return (
    <div className="space-y-3">
      {lines.length > 0 && (
        <ul className="divide-y rounded-xl ring-1 ring-foreground/10">
          {lines.map((l, i) => (
            <li key={l.sku} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1 basis-60">
                <p className="text-sm font-medium">{l.name}</p>
                <p className="text-xs text-muted-foreground">
                  Арт. {l.sku}
                  {l.supplier_price != null && <> · закупка {money(l.supplier_price)}</>}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button type="button" variant="outline" size="icon-sm" disabled={disabled || l.qty <= 1} onClick={() => update(i, { qty: l.qty - 1 })} aria-label="Меньше">
                  <Minus />
                </Button>
                <Input
                  type="number"
                  min={1}
                  value={l.qty}
                  onChange={(e) => update(i, { qty: Math.max(1, Number(e.target.value) || 1) })}
                  disabled={disabled}
                  className="h-8 w-14 text-center tabular-nums"
                  aria-label="Количество"
                />
                <Button type="button" variant="outline" size="icon-sm" disabled={disabled} onClick={() => update(i, { qty: l.qty + 1 })} aria-label="Больше">
                  <Plus />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={l.price}
                  onChange={(e) => update(i, { price: Number(e.target.value) })}
                  disabled={disabled}
                  className="h-8 w-28 text-right tabular-nums"
                  aria-label="Цена за штуку"
                />
                <span className="text-sm text-muted-foreground">₽</span>
              </div>
              <div className="w-28 text-right text-sm font-medium tabular-nums">{money(l.price * l.qty)}</div>
              <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label="Удалить">
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!disabled && <ProductPicker onPick={add} priceType={priceType} />}
    </div>
  );
}

function ProductPicker({ onPick, priceType }: { onPick: (p: AdminProduct) => void; priceType: PriceType }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AdminProduct[]>([]);
  const debounced = useDebounced(q.trim(), 250);

  useEffect(() => {
    if (debounced.length < 2) return;
    let cancelled = false;
    api<Page<AdminProduct>>(`/api/admin/products?${new URLSearchParams({ q: debounced, per_page: "8" })}`)
      .then((r) => !cancelled && setResults(r.items))
      .catch(() => !cancelled && setResults([]));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const shown = debounced.length >= 2 ? results : [];
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Добавить товар: название или артикул" className="h-9 pl-9" />
      {shown.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl bg-popover p-1 shadow-lg ring-1 ring-foreground/10">
          {shown.map((p) => (
            <li key={p.sku}>
              <button
                type="button"
                onClick={() => {
                  onPick(p);
                  setQ("");
                }}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- pre-optimised thumbnail */}
                {p.image ? <img src={p.image} alt="" className="size-9 rounded-md object-contain mix-blend-multiply" /> : <span className="size-9 rounded-md bg-muted" />}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1">{p.name}</span>
                  <span className="text-xs text-muted-foreground">
                    Арт. {p.sku} · {p.in_stock ? `в наличии ${p.qty}` : "нет в наличии"}
                  </span>
                </span>
                <span className="font-medium tabular-nums">{money(p.prices[priceType])}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Totals({ lines, delivery, discount }: { lines: Line[]; delivery: number; discount: number }) {
  const items = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const cost = lines.reduce((s, l) => s + (l.supplier_price ?? l.price) * l.qty, 0);
  return (
    <dl className="space-y-1.5 text-sm">
      <Row label="Товары" value={money(items)} />
      <Row label="Доставка" value={money(delivery)} />
      <Row label="Скидка" value={discount ? `−${money(discount)}` : money(0)} />
      <Row label="Итого" value={money(Math.max(0, items + delivery - discount))} strong />
      <Row label="Наценка (товары − скидка − закупка)" value={money(items - discount - cost)} muted />
    </dl>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t pt-2 text-base font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
