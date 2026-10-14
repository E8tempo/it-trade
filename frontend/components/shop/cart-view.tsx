"use client";

import { ArrowLeft, Building2, CircleAlert, Clock, LoaderCircle, LockKeyhole, ShoppingCart, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ProductImage } from "@/components/catalog/product-image";
import { PaymentChoice } from "@/components/shop/choice-card";
import { errorMessage } from "@/components/shop/errors";
import { PAYMENT, PROBLEM } from "@/components/shop/labels";
import { QtyStepper } from "@/components/shop/qty-stepper";
import { useCart, useSession, type CartLineInput } from "@/components/shop/session-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { countLabel, formatNumber, formatPrice } from "@/lib/format";
import type { Cart, CartItem, PaymentMethod } from "@/lib/types";
import { productHref } from "@/lib/urls";
import { cn } from "@/lib/utils";

/** Price x quantity in whole kopecks, so the sum matches the server's decimal arithmetic. */
export function lineTotal(price: number | null, qty: number): number | null {
  return price == null ? null : (Math.round(price * 100) * qty) / 100;
}

/**
 * Totals for both payment methods. The server's ones once everything is saved; while changes are on
 * their way, the same sum over the quantities on screen, so a total never lags behind the steppers.
 */
export function useCartTotals(cart: Cart | null): { totals: Record<PaymentMethod, number> | null; units: number; items: CartItem[] } {
  const { qty, syncing } = useCart();
  if (!cart) return { totals: null, units: 0, items: [] };
  const items = cart.items.filter((i) => qty(i.sku) > 0);
  const units = items.reduce((n, i) => n + qty(i.sku), 0);
  if (!syncing) return { totals: cart.totals, units, items };
  const sum = (m: PaymentMethod) => items.reduce((s, i) => s + (i.problem ? 0 : (lineTotal(i.prices[m], qty(i.sku)) ?? 0)), 0);
  return { totals: { cash: sum("cash"), cashless: sum("cashless") }, units, items };
}

const RESTORE_CHUNK = 500; // POST /api/cart/items takes up to 500 lines

export function CartView() {
  const { cart, loading, error, syncing, payment, setPayment, qty, setQty, remove, clear, add, refresh } = useCart();
  const { access } = useSession();
  const [clearing, setClearing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const { totals, units, items } = useCartTotals(cart);

  if (access === "guest" || access === "pending") return <NoCart access={access} />;
  if (loading) return <CartSkeleton />;
  if (!cart && error) {
    return (
      <CartShell>
        <div className="flex flex-col items-center rounded-3xl bg-muted/50 px-6 py-16 text-center">
          <p className="text-lg font-semibold">Не удалось загрузить корзину</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Проверьте подключение к интернету и попробуйте ещё раз.</p>
          <Button
            variant="outline"
            className="mt-5 h-10 rounded-xl px-4"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              refresh()
                .catch(() => toast.error("Корзина пока недоступна. Попробуйте чуть позже."))
                .finally(() => setRetrying(false));
            }}
          >
            {retrying && <LoaderCircle className="animate-spin" />}
            Повторить
          </Button>
        </div>
      </CartShell>
    );
  }
  if (!cart || !items.length) return <EmptyCart />;

  const problems = items.filter((i) => i.problem);
  // a line without a price for the chosen payment is a problem only after the cart is re-read for it
  const ready = cart.can_checkout && cart.payment === payment && !syncing;

  // adding back what was removed; the API checks stock and prices again
  const restore = async (lines: CartLineInput[]) => {
    try {
      for (let i = 0; i < lines.length; i += RESTORE_CHUNK) await add(lines.slice(i, i + RESTORE_CHUNK));
    } catch (e) {
      toast.error(errorMessage(e, "Не удалось вернуть товары в корзину"));
    }
  };

  const removeLine = (item: CartItem) => {
    const was = qty(item.sku);
    remove(item.sku);
    if (!item.problem) {
      toast("Товар удалён из корзины", {
        description: item.name,
        action: { label: "Вернуть", onClick: () => void restore([{ sku: item.sku, qty: was }]) },
      });
    }
  };

  const onClear = async () => {
    const snapshot = items.filter((i) => !i.problem).map((i) => ({ sku: i.sku, qty: qty(i.sku) }));
    setClearing(true);
    try {
      await clear();
      toast("Корзина очищена", snapshot.length ? { action: { label: "Вернуть", onClick: () => void restore(snapshot) } } : undefined);
    } catch (e) {
      toast.error(errorMessage(e, "Не удалось очистить корзину"));
    } finally {
      setClearing(false);
    }
  };

  const total = totals?.[payment] ?? 0;
  return (
    <CartShell
      count={items.length}
      action={
        <Button variant="ghost" className="h-9 gap-1.5 rounded-xl px-3 text-muted-foreground" onClick={onClear} disabled={clearing}>
          {clearing ? <LoaderCircle className="animate-spin" /> : <X />}
          Очистить корзину
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-label="Товары в корзине" className="min-w-0">
          {problems.length > 0 && (
            <div className="mb-4 flex flex-col gap-3 rounded-2xl bg-amber-500/10 p-4 text-sm sm:flex-row sm:items-center">
              <CircleAlert className="hidden size-5 shrink-0 text-amber-700 sm:block" />
              <p className="flex-1 text-amber-900">
                {problems.length === 1
                  ? "Один товар заказать уже нельзя. Удалите его, чтобы оформить заказ."
                  : `${countLabel(problems.length)} заказать уже нельзя. Удалите их, чтобы оформить заказ.`}
              </p>
              <Button variant="outline" className="h-9 shrink-0 rounded-xl bg-background" onClick={() => problems.forEach((i) => remove(i.sku))}>
                Удалить {problems.length === 1 ? "его" : "их"}
              </Button>
            </div>
          )}
          <ul className="divide-y border-y">
            {items.map((item) => (
              <CartLine
                key={item.sku}
                item={item}
                qty={qty(item.sku)}
                payment={payment}
                onQty={(q) => setQty(item.sku, q)}
                onRemove={() => removeLine(item)}
              />
            ))}
          </ul>
          <Link href="/catalog" className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            <ArrowLeft className="size-4" />
            Продолжить покупки
          </Link>
        </section>

        <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="Сумма заказа">
          <div className="space-y-5 rounded-3xl border p-5 sm:p-6">
            <p className="flex items-center gap-2 rounded-xl bg-primary/[0.06] px-3 py-2 text-[13px] font-medium text-primary">
              <Building2 className="size-4 shrink-0" />
              <span className="truncate">Цены для {cart.organization.name}</span>
            </p>
            <div className="space-y-3">
              <h2 className="text-base font-semibold">Способ оплаты</h2>
              <PaymentChoice value={payment} onChange={setPayment} totals={totals} />
            </div>
            <dl className="space-y-2 border-t pt-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Товары, {formatNumber(units)} шт.</dt>
                <dd className="tabular-nums">{formatPrice(total)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 pt-1">
                <dt className="text-base font-semibold">Итого</dt>
                <dd className={cn("text-2xl font-semibold tracking-tight tabular-nums transition-opacity", syncing && "opacity-60")}>
                  {formatPrice(total)}
                </dd>
              </div>
            </dl>
            <div className="max-lg:hidden">
              <CheckoutButton ready={ready} syncing={syncing} />
            </div>
            {!ready && !syncing && (
              <CheckoutHint problems={problems.length} stale={cart.payment !== payment} onRetry={() => void refresh().catch(() => undefined)} />
            )}
          </div>
        </aside>
      </div>

      {/* phones: the total and the button stay at hand while scrolling through a long cart */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:-mx-6 sm:px-6 lg:hidden">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground">Итого · {PAYMENT[payment].title.toLowerCase()}</p>
            <p className={cn("text-xl font-semibold tracking-tight tabular-nums transition-opacity", syncing && "opacity-60")}>{formatPrice(total)}</p>
          </div>
          <CheckoutButton ready={ready} syncing={syncing} className="w-auto px-5" />
        </div>
      </div>
    </CartShell>
  );
}

function CartShell({ count, action, children }: { count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight sm:text-3xl">Корзина</h1>
          {!!count && <span className="text-sm text-muted-foreground">{countLabel(count)}</span>}
        </div>
        {action}
      </div>
      {children}
    </>
  );
}

function CartLine({
  item,
  qty,
  payment,
  onQty,
  onRemove,
}: {
  item: CartItem;
  qty: number;
  payment: PaymentMethod;
  onQty: (qty: number) => void;
  onRemove: () => void;
}) {
  const href = productHref(item);
  const price = item.prices[payment];
  const total = lineTotal(price, qty);
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-x-3 gap-y-3 py-4 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:gap-x-4">
      <Link href={href} tabIndex={-1} aria-hidden className="block aspect-square overflow-hidden rounded-xl bg-muted/70 p-1.5 sm:row-span-2">
        <ProductImage image={item.image} alt="" sizes="96px" className={cn(item.problem && "opacity-50 grayscale")} />
      </Link>

      <div className="min-w-0">
        <Link href={href} className="line-clamp-2 text-sm leading-snug font-medium hover:text-primary sm:text-[15px]">
          {item.name}
        </Link>
        <p className="mt-1 text-xs text-muted-foreground">
          Артикул <span className="font-mono">{item.sku}</span>
          {item.vendor && ` · ${item.vendor}`}
        </p>
        {item.problem ? (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/12 px-2.5 py-1 text-xs font-medium text-amber-800">
            <CircleAlert className="size-3.5" />
            {PROBLEM[item.problem]}
          </p>
        ) : (
          qty > item.stock && (
            <p className="mt-1.5 text-xs text-amber-700">В наличии только {formatNumber(item.stock)} шт.</p>
          )
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Удалить из корзины: ${item.name}`}
        className="-mt-1.5 -mr-1.5 grid size-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:-mr-2"
      >
        <Trash2 className="size-[18px]" />
      </button>

      <div className="col-span-3 flex items-center justify-between gap-3 sm:col-span-2 sm:col-start-2">
        {item.problem ? (
          <p className="text-[13px] text-muted-foreground">Удалите товар, чтобы оформить заказ</p>
        ) : (
          <>
            <QtyStepper value={qty} step={item.multiplicity} onChange={onQty} label={`Количество: ${item.name}`} />
            <div className="text-right">
              <p className="text-base font-semibold tracking-tight tabular-nums">{formatPrice(total)}</p>
              {qty > 1 && price != null && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatPrice(price)} × {formatNumber(qty)}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </li>
  );
}

function CheckoutButton({ ready, syncing, className }: { ready: boolean; syncing: boolean; className?: string }) {
  const look = cn(buttonVariants({ size: "lg" }), "h-12 w-full gap-2 rounded-xl text-[15px]", className);
  if (!ready) {
    return (
      <Button className={look} disabled>
        {syncing && <LoaderCircle className="animate-spin" />}
        Оформить заказ
      </Button>
    );
  }
  return (
    <Link href="/checkout" className={look}>
      Оформить заказ
    </Link>
  );
}

/** Why «Оформить заказ» is disabled (while saving, the button's spinner says it). */
function CheckoutHint({ problems, stale, onRetry }: { problems: number; stale: boolean; onRetry: () => void }) {
  if (problems) {
    return (
      <p className="text-[13px] text-muted-foreground" role="status">
        Удалите из корзины товары, которые нельзя заказать.
      </p>
    );
  }
  if (!stale) return null;
  // the cart was not re-read for the new payment method (no connection)
  return (
    <p className="text-[13px] text-muted-foreground" role="status">
      Не удалось пересчитать корзину.{" "}
      <button type="button" onClick={onRetry} className="font-medium text-primary hover:underline">
        Повторить
      </button>
    </p>
  );
}

function EmptyCart() {
  return (
    <CartShell>
      <div className="flex flex-col items-center rounded-3xl bg-muted/50 px-6 py-16 text-center sm:py-20">
        <span className="grid size-14 place-items-center rounded-2xl bg-background shadow-xs">
          <ShoppingCart className="size-6 text-muted-foreground" />
        </span>
        <p className="mt-5 text-lg font-semibold">В корзине пока пусто</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Загляните в каталог: товары, которые вы добавите, сохранятся в корзине на всех ваших устройствах.
        </p>
        <Link href="/catalog" className={cn(buttonVariants({ size: "lg" }), "mt-6 h-11 rounded-xl px-5")}>
          Перейти в каталог
        </Link>
      </div>
    </CartShell>
  );
}

/** The cart is a client's: a guest learns how to become one, a client being checked waits for it. */
function NoCart({ access }: { access: "guest" | "pending" }) {
  return (
    <CartShell>
      <div className="flex flex-col items-center rounded-3xl bg-muted/50 px-6 py-16 text-center sm:py-20">
        <span className="grid size-14 place-items-center rounded-2xl bg-background shadow-xs">
          {access === "guest" ? <LockKeyhole className="size-6 text-muted-foreground" /> : <Clock className="size-6 text-amber-700" />}
        </span>
        <p className="mt-5 text-lg font-semibold">{access === "guest" ? "Корзина — для клиентов" : "Организация на проверке"}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {access === "guest"
            ? "Мы работаем с компаниями и ИП. Зарегистрируйте организацию или войдите, чтобы видеть цены и оформлять заказы."
            : "Корзина и заказы откроются, когда менеджер подтвердит вашу организацию. Обычно это занимает рабочий день."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {access === "guest" ? (
            <>
              <Link href="/register" className={cn(buttonVariants({ size: "lg" }), "h-11 rounded-xl px-5")}>
                Стать клиентом
              </Link>
              <Link href="/login?next=%2Fcart" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 rounded-xl px-5")}>
                Войти
              </Link>
            </>
          ) : (
            <Link href="/account/organizations" className={cn(buttonVariants({ size: "lg" }), "h-11 rounded-xl px-5")}>
              Статус проверки
            </Link>
          )}
        </div>
      </div>
    </CartShell>
  );
}

function CartSkeleton() {
  return (
    <CartShell>
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]" aria-hidden>
        <div className="divide-y border-y">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex gap-3 py-4 sm:gap-4">
              <Skeleton className="size-[4.5rem] shrink-0 rounded-xl sm:size-24" />
              <div className="flex-1 space-y-2.5">
                <Skeleton className="h-4 w-full max-w-md" />
                <Skeleton className="h-4 w-2/3 max-w-xs" />
                <Skeleton className="h-9 w-28 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="h-80 rounded-3xl" />
      </div>
    </CartShell>
  );
}
