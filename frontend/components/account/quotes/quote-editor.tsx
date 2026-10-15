"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CircleAlert,
  Copy,
  LoaderCircle,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
  Undo2,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { AccountSkeleton, PageHeading } from "@/components/account/account-shell";
import { LoadError } from "@/components/account/orders-view";
import { CommitInput, NumberInput, numberText, parseNumber } from "@/components/account/quotes/fields";
import { PRICE_SOURCE, quoteName, ROUND_ITEMS, VAT_ITEMS } from "@/components/account/quotes/labels";
import { useQuote, type QuoteApi } from "@/components/account/quotes/use-quote";
import { ACCOUNT_CARD, CARD_HEAD, Pill } from "@/components/account/ui";
import { ProductImage } from "@/components/catalog/product-image";
import { errorMessage, hasStatus } from "@/components/shop/errors";
import { PROBLEM } from "@/components/shop/labels";
import { useCart, useSession } from "@/components/shop/session-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api/client";
import { countLabel, formatDate, formatMoney, formatNumber } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import type { BuyerPrices, PaymentMethod, ProductCard, ProductPage, Quote, QuoteLine } from "@/lib/types";
import { productHref } from "@/lib/urls";
import { cn } from "@/lib/utils";

const BACK = "mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground";
const SMALL = "h-9 rounded-lg px-2.5 text-right tabular-nums";

/** The editor of one offer: whom it is for, the lines and their prices, the terms; the totals and the client's
 * profit on the side. Every field saves itself. */
export function QuoteEditor({ id }: { id: string }) {
  const q = useQuote(id);
  const { quote } = q;

  if (!q.valid || hasStatus(q.error, 404, 422)) return <NotFound />;
  if (q.error && !quote) return <LoadError message={errorMessage(q.error, "Не удалось загрузить КП.")} onRetry={q.reload} />;
  if (!quote) return <AccountSkeleton />;

  return (
    <div className="max-w-6xl">
      <Link href="/account/quotes" className={BACK}>
        <ArrowLeft className="size-4" />
        Все КП
      </Link>
      <PageHeading
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {quoteName(quote.number)}
            {q.saving && <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-label="Сохраняется" />}
          </span>
        }
        lead={`от ${formatDate(quote.created_at)} · ${quote.seller.name}`}
        action={<HeaderActions quote={quote} />}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <CustomerCard quote={quote} q={q} />
          <LinesCard quote={quote} q={q} />
          <TermsCard quote={quote} q={q} />
        </div>
        <aside className="space-y-6 lg:sticky lg:top-[calc(var(--header-h)+1.5rem)] lg:self-start" aria-label="Цены и итоги">
          <TotalsCard quote={quote} />
          <PricingCard quote={quote} q={q} />
        </aside>
      </div>
    </div>
  );
}

// --- the header ----------------------------------------------------------------------------

function HeaderActions({ quote }: { quote: Quote }) {
  const router = useRouter();
  const { keepSession } = useSession();
  const { cart, add } = useCart();
  const [busy, setBusy] = useState<"copy" | "cart" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const products = quote.items.filter((i) => i.sku != null && !i.problem);

  const copy = () => {
    setBusy("copy");
    keepSession()
      .then(() => api<Quote>(`/api/quotes/${quote.id}/copy`, { method: "POST" }))
      .then(
        (c) => {
          toast.success(`${quoteName(c.number)} — копия по сегодняшним ценам`);
          router.push(`/account/quotes/${c.id}`);
        },
        (e: unknown) => toast.error(errorMessage(e, "Не удалось скопировать КП")),
      )
      .finally(() => setBusy(null));
  };

  const toCart = () => {
    setBusy("cart");
    add(products.map((i) => ({ sku: i.sku as number, qty: i.qty })))
      .then(
        (c) => {
          const missed = c.not_added.length;
          toast.success(missed ? `В корзине. Не добавлено: ${countLabel(missed)}` : "Товары КП в корзине", {
            description: c.organization.id !== quote.organization_id ? `Корзина — для ${c.organization.name}` : undefined,
            action: { label: "Корзина", onClick: () => router.push("/cart") },
          });
        },
        (e: unknown) => toast.error(errorMessage(e, "Не удалось добавить в корзину")),
      )
      .finally(() => setBusy(null));
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/print/quotes/${quote.id}`} target="_blank" className={cn(buttonVariants(), "h-10 gap-2 rounded-xl px-4")}>
        <Printer />
        Печать и PDF
      </Link>
      <Button
        variant="outline"
        className="h-10 gap-2 rounded-xl px-3.5"
        disabled={busy !== null || !products.length || !cart}
        onClick={toCart}
        title="Заказать товары этого КП у нас"
      >
        {busy === "cart" ? <LoaderCircle className="animate-spin" /> : <ShoppingCart />}
        В корзину
      </Button>
      <Button variant="outline" className="h-10 gap-2 rounded-xl px-3.5" disabled={busy !== null} onClick={copy}>
        {busy === "copy" ? <LoaderCircle className="animate-spin" /> : <Copy />}
        Копия
      </Button>
      <Button variant="ghost" className="h-10 rounded-xl px-3 text-muted-foreground" aria-label="Удалить КП" onClick={() => setDeleting(true)}>
        <Trash2 />
      </Button>
      <DeleteDialog quote={quote} open={deleting} onOpenChange={setDeleting} />
    </div>
  );
}

function DeleteDialog({ quote, open, onOpenChange }: { quote: Quote; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { keepSession } = useSession();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 p-5 sm:max-w-md sm:p-6">
        <DialogHeader>
          <DialogTitle>Удалить {quoteName(quote.number)}?</DialogTitle>
          <DialogDescription>КП удалится вместе со всеми строками. Вернуть его не получится.</DialogDescription>
        </DialogHeader>
        <DialogFooter className="-mx-5 -mb-5 rounded-b-xl px-5 sm:-mx-6 sm:-mb-6 sm:px-6">
          <Button variant="outline" className="h-10 rounded-xl" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            className="h-10 gap-2 rounded-xl"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              keepSession()
                .then(() => api(`/api/quotes/${quote.id}`, { method: "DELETE" }))
                .then(
                  () => {
                    toast.success(`${quoteName(quote.number)} удалено`);
                    router.replace("/account/quotes");
                  },
                  (e: unknown) => {
                    toast.error(errorMessage(e, "Не удалось удалить КП"));
                    setBusy(false);
                  },
                );
            }}
          >
            {busy && <LoaderCircle className="animate-spin" />}
            Удалить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- whom it is for ------------------------------------------------------------------------

function CustomerCard({ quote, q }: { quote: Quote; q: QuoteApi }) {
  return (
    <Card className={ACCOUNT_CARD}>
      <CardHeader className={CARD_HEAD}>
        <CardTitle className="text-base font-semibold">Для кого</CardTitle>
        <CardDescription>Ваш заказчик и тема — они будут в шапке КП</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 py-(--card-spacing) sm:grid-cols-2">
        <TextField label="Заказчик" id="customer" className="sm:col-span-2">
          <CommitInput
            id="customer"
            value={quote.customer ?? ""}
            onCommit={(v) => q.patch({ customer: v })}
            placeholder="ООО «Заказчик» или ИП Петров П. П."
            maxLength={255}
            className="h-10 rounded-xl"
          />
        </TextField>
        <TextField label="Контактное лицо" id="customer_contact">
          <CommitInput
            id="customer_contact"
            value={quote.customer_contact ?? ""}
            onCommit={(v) => q.patch({ customer_contact: v })}
            placeholder="Имя, телефон"
            maxLength={255}
            className="h-10 rounded-xl"
          />
        </TextField>
        <TextField label="Тема" id="title">
          <CommitInput
            id="title"
            value={quote.title ?? ""}
            onCommit={(v) => q.patch({ title: v })}
            placeholder="Например, оснащение офиса"
            maxLength={255}
            className="h-10 rounded-xl"
          />
        </TextField>
      </CardContent>
    </Card>
  );
}

function TextField({ label, id, className, children }: { label: string; id: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

// --- the lines -----------------------------------------------------------------------------

function LinesCard({ quote, q }: { quote: Quote; q: QuoteApi }) {
  const [own, setOwn] = useState(false);
  const { totals } = quote;
  return (
    // the search's suggestions open over the cards below
    <Card className={cn(ACCOUNT_CARD, "overflow-visible")}>
      <CardHeader className={CARD_HEAD}>
        <CardTitle className="text-base font-semibold">Товары и услуги</CardTitle>
        <CardDescription>
          {quote.items.length
            ? `${countLabel(quote.items.length, ["строка", "строки", "строк"])}, ${formatNumber(totals.units)} ед.`
            : "Найдите товар каталога или добавьте свою строку — монтаж, доставку"}
        </CardDescription>
      </CardHeader>
      <CardContent className="py-(--card-spacing)">
        {totals.changed > 0 && (
          <div className="mb-4 flex flex-col gap-3 rounded-2xl bg-amber-500/10 p-4 text-sm sm:flex-row sm:items-center">
            <CircleAlert className="hidden size-5 shrink-0 text-amber-700 sm:block" />
            <p className="flex-1 text-amber-900">
              {totals.changed === 1 ? "У одного товара" : `У ${countLabel(totals.changed, ["товара", "товаров", "товаров"])}`} изменилась наша цена с тех пор, как
              {totals.changed === 1 ? " он попал" : " они попали"} в КП. Цены в КП пока прежние.
            </p>
            <Button variant="outline" className="h-9 shrink-0 gap-2 rounded-xl bg-background" onClick={() => void q.refreshPrices()} disabled={q.saving}>
              <RefreshCw />
              Обновить цены
            </Button>
          </div>
        )}
        {quote.items.length > 0 && (
          <ul className="divide-y border-y">
            {quote.items.map((line, n) => (
              <LineRow key={line.id} quote={quote} line={line} index={n} q={q} />
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <ProductPicker quote={quote} onPick={(sku) => q.addLines([{ sku, qty: 1 }])} />
          <Button variant="outline" className="h-10 shrink-0 gap-2 rounded-xl" onClick={() => setOwn(true)}>
            <Wrench />
            Своя строка
          </Button>
        </div>
        <OwnLineDialog open={own} onOpenChange={setOwn} q={q} />
      </CardContent>
    </Card>
  );
}

function markupOf(line: QuoteLine): number | null {
  if (line.sale_price == null || !line.cost) return null;
  return Math.round((line.sale_price / line.cost - 1) * 1000) / 10;
}

function LineRow({ quote, line, index, q }: { quote: Quote; line: QuoteLine; index: number; q: QuoteApi }) {
  const own = line.sku == null;
  const last = index === quote.items.length - 1;
  const markup = markupOf(line);
  const changed = !own && line.current_cost !== line.cost;
  return (
    // the name and what it is on top, the numbers under it: the name needs the whole width
    <li className="grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-x-3 gap-y-3 py-4">
      <span className="block aspect-square overflow-hidden rounded-xl bg-muted/70 p-1">
        {own ? (
          <span className="grid size-full place-items-center text-muted-foreground">
            <Wrench className="size-4" />
          </span>
        ) : (
          <ProductImage image={line.image} alt="" sizes="48px" />
        )}
      </span>
      <div className="min-w-0 space-y-1">
        <CommitInput
          multiline="wrap"
          value={line.name}
          onCommit={(v) => {
            if (v) return q.patchLine(line.id, { name: v });
            toast.error("Название не может быть пустым");
          }}
          aria-label="Наименование"
          maxLength={1024}
          className="min-h-0 resize-none rounded-lg border-transparent bg-transparent px-2 py-1.5 text-sm leading-snug font-medium shadow-none hover:border-input focus-visible:border-ring md:text-sm dark:bg-transparent"
        />
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 text-xs text-muted-foreground tabular-nums">
          {!own && (line.part || line.vendor) && <span>{[line.vendor, line.part].filter(Boolean).join(" · ")}</span>}
          {!own && line.slug && (
            <Link href={productHref({ sku: line.sku as number, slug: line.slug })} target="_blank" className="hover:text-foreground hover:underline">
              арт. {line.sku}
            </Link>
          )}
          {line.cost != null && <span>закупка {formatMoney(line.cost)}</span>}
          {changed && (
            <span className="text-amber-700">сейчас {line.current_cost != null ? formatMoney(line.current_cost) : "не продаётся"}</span>
          )}
          {line.price_source && line.price_source !== "markup" && <span>{PRICE_SOURCE[line.price_source]}</span>}
          {line.problem && <Pill tone="bg-amber-500/15 text-amber-800 py-0.5">{PROBLEM[line.problem]}</Pill>}
          {!line.problem && !own && line.stock > 0 && <span>в наличии {formatNumber(line.stock)}</span>}
        </p>
      </div>

      <div className="-mr-1 flex items-start gap-0.5">
        <div className="flex">
          <IconButton label="Выше" disabled={index === 0} onClick={() => void q.patchLine(line.id, { position: index - 1 })}>
            <ArrowUp />
          </IconButton>
          <IconButton label="Ниже" disabled={last} onClick={() => void q.patchLine(line.id, { position: index + 1 })}>
            <ArrowDown />
          </IconButton>
        </div>
        <IconButton label="Удалить строку" onClick={() => void q.removeLine(line.id)}>
          <Trash2 />
        </IconButton>
      </div>

      <div className="col-span-2 col-start-2 grid grid-cols-3 items-start gap-x-2 gap-y-2 sm:grid-cols-[5.5rem_6.5rem_8rem_minmax(0,1fr)]">
        <Cell label="Кол-во">
          <NumberInput value={line.qty} min={1} max={99999} what="количество" onCommit={(n) => q.patchLine(line.id, { qty: Math.round(n ?? 1) })} aria-label="Количество" className={SMALL} />
          <span className="mt-1 block text-right text-[11px] text-muted-foreground">{line.unit}</span>
        </Cell>
        <Cell label="Наценка, %">
          {own ? (
            <span className="block h-9 pt-2 text-right text-sm text-muted-foreground">—</span>
          ) : (
            <>
              <NumberInput
                value={line.markup_percent}
                nullable
                max={10000}
                what="наценку"
                placeholder={numberText(line.price_source === "markup" ? quote.markup_percent : markup)}
                onCommit={(n) => q.patchLine(line.id, { markup_percent: n, ...(n != null && line.price != null ? { price: null } : {}) })}
                aria-label="Наценка, %"
                className={cn(SMALL, line.price_source !== "markup" && "placeholder:text-muted-foreground/50")}
                disabled={line.cost == null}
              />
              {markup != null && line.markup_percent == null && line.price_source !== "markup" && (
                <span className="mt-1 block text-right text-[11px] text-muted-foreground">{numberText(markup)} %</span>
              )}
            </>
          )}
        </Cell>
        <Cell label="Цена, ₽">
          <div className="relative">
            <NumberInput
              value={line.price}
              nullable={!own}
              max={999_999_999}
              what="цену"
              placeholder={line.sale_price != null ? numberText(line.sale_price) : "цена"}
              onCommit={(n) => q.patchLine(line.id, { price: n })}
              aria-label="Цена за единицу"
              className={cn(SMALL, "placeholder:text-foreground", line.price != null && !own && "pr-7")}
            />
            {line.price != null && !own && (
              <button
                type="button"
                className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Цена по наценке"
                title="Считать цену по наценке"
                onClick={() => void q.patchLine(line.id, { price: null })}
              >
                <Undo2 className="size-3.5" />
              </button>
            )}
          </div>
        </Cell>
        <p className="col-span-3 text-right text-[15px] font-semibold tracking-tight tabular-nums sm:col-span-1 sm:pt-6">
          {line.total != null ? formatMoney(line.total) : <span className="text-sm font-normal text-amber-700">нет цены</span>}
          {line.profit != null && (
            <span className={cn("block text-[11px] font-normal", line.profit < 0 ? "text-destructive" : "text-muted-foreground")}>
              {line.profit < 0 ? "убыток " : "+"}
              {formatMoney(Math.abs(line.profit))}
            </span>
          )}
        </p>
      </div>
    </li>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

const MIN_CHARS = 2;

/** Search of the catalog, with what the client pays us for each product. */
function ProductPicker({ quote, onPick }: { quote: Quote; onPick: (sku: number) => void }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<{ q: string; items: ProductCard[]; prices: BuyerPrices["prices"] } | null>(null);
  const query = useDebounced(value.trim(), 250);

  useEffect(() => {
    if (query.length < MIN_CHARS) return;
    const ctrl = new AbortController();
    const sp = new URLSearchParams({ q: query, per_page: "8", facets: "false" });
    fetch(`/api/products?${sp}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<ProductPage>) : Promise.reject(new Error(String(r.status)))))
      .then(async (page) => {
        const skus = new URLSearchParams(page.items.map((p) => ["sku", String(p.sku)]));
        const prices = page.items.length ? (await api<BuyerPrices>(`/api/cart/prices?${skus}`)).prices : {};
        if (!ctrl.signal.aborted) setFound({ q: query, items: page.items, prices });
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [query]);

  const active = value.trim().length >= MIN_CHARS;
  const items = active && found ? found.items : [];
  const loading = active && found?.q !== query;
  const inQuote = new Set(quote.items.map((i) => i.sku));

  return (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder="Добавить товар: название, бренд или артикул"
        aria-label="Добавить товар"
        autoComplete="off"
        className="h-10 rounded-xl pr-9 pl-9"
      />
      {loading && open && <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      {open && active && (items.length > 0 || !loading) && (
        <ul data-suggestions className="absolute inset-x-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-xl bg-popover p-1 shadow-lg ring-1 ring-foreground/10">
          {items.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">Ничего не нашлось</li>}
          {items.map((p) => {
            const cost = found?.prices[p.sku]?.[quote.payment] ?? null;
            const there = inQuote.has(p.sku);
            return (
              <li key={p.sku}>
                <button
                  type="button"
                  // a click must not blur the input first: the list would close before it
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(p.sku);
                    setValue("");
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="block size-10 shrink-0 overflow-hidden rounded-md bg-muted/70 p-0.5">
                    <ProductImage image={p.image} alt="" sizes="40px" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {[p.vendor, p.part].filter(Boolean).join(" · ")}
                      {p.vendor || p.part ? " · " : ""}
                      {p.in_stock ? `в наличии ${formatNumber(p.qty)}` : "нет в наличии"}
                      {there && " · уже в КП"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-medium tabular-nums">{cost != null ? formatMoney(cost) : "—"}</span>
                    <span className="text-[11px] text-muted-foreground">закупка</span>
                  </span>
                  <Plus className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function OwnLineDialog({ open, onOpenChange, q }: { open: boolean; onOpenChange: (open: boolean) => void; q: QuoteApi }) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("усл.");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = () => {
    const n = parseNumber(qty);
    const p = parseNumber(price);
    if (!name.trim()) return toast.error("Укажите название");
    if (n == null || n < 1 || !Number.isInteger(n)) return toast.error("Проверьте количество");
    if (p == null || p < 0) return toast.error("Укажите цену");
    setBusy(true);
    q.addLines([{ name: name.trim(), qty: n, unit: unit.trim() || undefined, price: p }])
      .then((res) => {
        if (!res) return;
        setName("");
        setQty("1");
        setPrice("");
        onOpenChange(false);
      })
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 p-5 sm:max-w-md sm:p-6">
        <DialogHeader>
          <DialogTitle>Своя строка</DialogTitle>
          <DialogDescription>Ваши работы и услуги — монтаж, настройка, доставка. В сумму КП войдут целиком.</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-3 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <TextField label="Название" id="own-name" className="col-span-3">
            <Input id="own-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={1024} placeholder="Монтаж и настройка" className="h-10 rounded-xl" autoFocus />
          </TextField>
          <TextField label="Количество" id="own-qty">
            <Input id="own-qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className="h-10 rounded-xl" />
          </TextField>
          <TextField label="Ед. изм." id="own-unit">
            <Input id="own-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={16} className="h-10 rounded-xl" />
          </TextField>
          <TextField label="Цена, ₽" id="own-price">
            <Input id="own-price" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="h-10 rounded-xl" />
          </TextField>
          <DialogFooter className="col-span-3 -mx-5 mt-2 -mb-5 rounded-b-xl px-5 sm:-mx-6 sm:-mb-6 sm:px-6">
            <Button type="submit" className="h-10 gap-2 rounded-xl" disabled={busy}>
              {busy && <LoaderCircle className="animate-spin" />}
              Добавить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- terms ---------------------------------------------------------------------------------

function TermsCard({ quote, q }: { quote: Quote; q: QuoteApi }) {
  return (
    <Card className={ACCOUNT_CARD}>
      <CardHeader className={CARD_HEAD}>
        <CardTitle className="text-base font-semibold">Условия</CardTitle>
        <CardDescription>Печатаются под таблицей</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 py-(--card-spacing) sm:grid-cols-[minmax(0,1fr)_12rem]">
        <TextField label="Оплата, поставка, гарантия" id="terms">
          <CommitInput
            multiline
            id="terms"
            value={quote.terms ?? ""}
            onCommit={(v) => q.patch({ terms: v })}
            placeholder={"Оплата: 100 % предоплата\nСрок поставки: 3–5 рабочих дней\nГарантия: 12 месяцев"}
            maxLength={4000}
            className="min-h-28 rounded-xl"
          />
        </TextField>
        <div className="space-y-4">
          <TextField label="Действует до" id="valid_until">
            <Input
              id="valid_until"
              type="date"
              value={quote.valid_until ?? ""}
              onChange={(e) => void q.patch({ valid_until: e.target.value || null })}
              className="h-10 rounded-xl"
            />
          </TextField>
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            Фото товаров
            <Switch checked={quote.show_photos} onCheckedChange={(v) => void q.patch({ show_photos: v })} />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

// --- the side: totals and pricing ----------------------------------------------------------

function TotalsCard({ quote }: { quote: Quote }) {
  const t = quote.totals;
  const pct = t.cost > 0 ? Math.round((t.profit / t.cost) * 1000) / 10 : null;
  return (
    <Card className={ACCOUNT_CARD}>
      <CardContent className="space-y-2 py-(--card-spacing) text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-base font-semibold">Сумма КП</span>
          <span className="text-2xl font-semibold tracking-tight tabular-nums">{formatMoney(t.total)}</span>
        </div>
        <p className="text-right text-xs text-muted-foreground">
          {t.vat != null ? `в том числе НДС ${quote.vat_rate} % — ${formatMoney(t.vat)}` : "без НДС"}
        </p>
        <div className="space-y-2 border-t pt-3">
          <Row label="Закупка у нас">{formatMoney(t.cost)}</Row>
          <Row label="Ваша наценка">
            <span className={cn("font-medium", t.profit < 0 ? "text-destructive" : "text-emerald-700")}>
              {formatMoney(t.profit)}
              {pct != null && ` · ${numberText(pct)} %`}
            </span>
          </Row>
        </div>
        {t.unpriced > 0 && (
          <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-900">
            {t.unpriced === 1 ? "У одной строки" : `У ${countLabel(t.unpriced, ["строки", "строк", "строк"])}`} нет цены — в сумму не вошли. Укажите цену вручную.
          </p>
        )}
        <p className="pt-1 text-xs text-muted-foreground">Закупка и наценка видны только вам, в КП их нет.</p>
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  );
}

const PAYMENT_ITEMS: Record<PaymentMethod, string> = { cashless: "Безнал", cash: "Наличные" };

function PricingCard({ quote, q }: { quote: Quote; q: QuoteApi }) {
  return (
    <Card className={ACCOUNT_CARD}>
      <CardHeader className={CARD_HEAD}>
        <CardTitle className="text-base font-semibold">Цены в КП</CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" className="gap-1.5 rounded-lg text-muted-foreground" onClick={() => void q.refreshPrices()} disabled={q.saving} title="Взять наши сегодняшние цены">
            <RefreshCw />
            Обновить
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 py-(--card-spacing)">
        <TextField label="Наценка на закупку, %" id="markup">
          <NumberInput
            id="markup"
            value={quote.markup_percent}
            max={10000}
            what="наценку"
            onCommit={(n) => q.patch({ markup_percent: n })}
            className="h-10 rounded-xl tabular-nums"
          />
        </TextField>
        <label className="flex cursor-pointer items-start justify-between gap-3 text-sm">
          <span>
            Цена по РРЦ, где она есть
            <span className="block text-xs text-muted-foreground">рекомендованная розничная цена производителя</span>
          </span>
          <Switch checked={quote.use_rrp} onCheckedChange={(v) => void q.patch({ use_rrp: v })} className="mt-0.5" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Округление" id="round_to">
            <Select items={ROUND_ITEMS} value={String(quote.round_to)} onValueChange={(v) => v != null && void q.patch({ round_to: Number(v) })}>
              <SelectTrigger id="round_to" className="h-10 w-full rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROUND_ITEMS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </TextField>
          <TextField label="НДС" id="vat">
            <Select items={VAT_ITEMS} value={quote.vat_rate == null ? "none" : String(quote.vat_rate)} onValueChange={(v) => v != null && void q.patch({ vat_rate: v === "none" ? null : Number(v) })}>
              <SelectTrigger id="vat" className="h-10 w-full rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(VAT_ITEMS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </TextField>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Закупка у нас — по цене</p>
          <div role="radiogroup" aria-label="Закупка по цене" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
            {(Object.keys(PAYMENT_ITEMS) as PaymentMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={quote.payment === m}
                onClick={() => quote.payment !== m && void q.patch({ payment: m })}
                className={cn(
                  "h-8 rounded-lg text-sm font-medium transition-colors",
                  quote.payment === m ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {PAYMENT_ITEMS[m]}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Как вы будете платить нам за эти товары: от этого зависит закупка.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-center rounded-3xl bg-muted/50 px-6 py-14 text-center">
      <p className="text-lg font-semibold">КП не найдено</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">Возможно, его удалили или оно сделано от организации, где вы больше не работаете.</p>
      <Link href="/account/quotes" className={cn(buttonVariants({ variant: "outline" }), "mt-5 h-10 rounded-xl px-4")}>
        Все КП
      </Link>
    </div>
  );
}
