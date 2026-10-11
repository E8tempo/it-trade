"use client";

import { Check, LoaderCircle, Lock, Pencil, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Empty } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiErrorText } from "@/lib/admin/errors";
import { money } from "@/lib/admin/labels";
import type { AdminProduct } from "@/lib/admin/types";
import { api } from "@/lib/api/client";
import { productHref } from "@/lib/urls";
import { cn } from "@/lib/utils";

export function ProductsTable({ products }: { products: AdminProduct[] }) {
  if (products.length === 0) return <Empty>Ничего не найдено</Empty>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12" />
          <TableHead>Товар</TableHead>
          <TableHead className="text-right">Закупка</TableHead>
          <TableHead className="text-right">РРЦ</TableHead>
          <TableHead className="text-right">Цена на сайте</TableHead>
          <TableHead className="text-right">Наценка</TableHead>
          <TableHead className="text-right">Остаток</TableHead>
          <TableHead className="text-center">Показывать</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((p) => (
          <ProductRow key={p.sku} product={p} />
        ))}
      </TableBody>
    </Table>
  );
}

function ProductRow({ product }: { product: AdminProduct }) {
  const router = useRouter();
  const [p, setP] = useState(product);
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      setP(await api<AdminProduct>(`/api/admin/products/${p.sku}`, { method: "PATCH", body: JSON.stringify(body) }));
      setEditing(false);
      toast.success(done);
      router.refresh();
    } catch (e) {
      toast.error(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  const markupTone =
    p.markup_percent == null ? "" : p.markup_percent < 5 ? "text-destructive" : p.markup_percent < 12 ? "text-amber-700" : "";

  return (
    <TableRow className={cn(p.is_hidden && "opacity-60")}>
      <TableCell>
        {/* eslint-disable-next-line @next/next/no-img-element -- pre-optimised thumbnail */}
        {p.image ? <img src={p.image} alt="" className="size-10 rounded-md object-contain mix-blend-multiply" /> : <div className="size-10 rounded-md bg-muted" />}
      </TableCell>
      <TableCell className="max-w-[28rem] whitespace-normal">
        <a href={productHref(p)} target="_blank" className="line-clamp-2 font-medium hover:underline">
          {p.name}
        </a>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Арт. {p.sku}
          {p.vendor && <> · {p.vendor}</>}
          {p.category && <> · {p.category.name}</>}
        </p>
      </TableCell>
      <TableCell className="text-right whitespace-nowrap tabular-nums">{money(p.supplier_price)}</TableCell>
      <TableCell className="text-right whitespace-nowrap text-muted-foreground tabular-nums">{money(p.rrp)}</TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {editing ? (
          <form
            className="flex items-center justify-end gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const v = Number(price);
              if (v > 0) save({ price_override: v }, "Цена зафиксирована");
            }}
          >
            <Input autoFocus type="number" min={1} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="h-8 w-28 text-right tabular-nums" />
            <Button type="submit" size="icon-sm" disabled={busy || !(Number(price) > 0)} aria-label="Сохранить">
              {busy ? <LoaderCircle className="animate-spin" /> : <Check />}
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => setEditing(false)} aria-label="Отмена">
              <X />
            </Button>
          </form>
        ) : (
          <div className="flex items-center justify-end gap-1">
            {p.price_override != null && (
              <Tooltip>
                <TooltipTrigger render={<span className="text-primary" />}>
                  <Lock className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>Фиксированная цена: наценки на неё не действуют</TooltipContent>
              </Tooltip>
            )}
            <span className="font-medium tabular-nums">{money(p.price)}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                setPrice(String(p.price ?? ""));
                setEditing(true);
              }}
              aria-label="Задать цену вручную"
            >
              <Pencil />
            </Button>
            {p.price_override != null && (
              <Button variant="ghost" size="icon-xs" disabled={busy} onClick={() => save({ price_override: null }, "Цена снова считается по наценкам")} aria-label="Вернуть цену по наценкам">
                <RotateCcw />
              </Button>
            )}
          </div>
        )}
      </TableCell>
      <TableCell className={cn("text-right whitespace-nowrap tabular-nums", markupTone)}>
        {p.markup_percent == null ? "—" : `${p.markup_percent.toLocaleString("ru-RU")}%`}
      </TableCell>
      <TableCell className="text-right tabular-nums">{p.in_stock ? p.qty : <span className="text-muted-foreground">нет</span>}</TableCell>
      <TableCell className="text-center">
        <Switch
          checked={!p.is_hidden}
          disabled={busy}
          onCheckedChange={(show) => save({ is_hidden: !show }, show ? "Товар снова на сайте" : "Товар скрыт с сайта")}
          aria-label="Показывать на сайте"
        />
      </TableCell>
    </TableRow>
  );
}
