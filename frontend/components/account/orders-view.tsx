"use client";

import { Building2, ChevronRight, LoaderCircle, Package } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { AccountSkeleton, PageHeading } from "@/components/account/account-shell";
import { errorMessage } from "@/components/shop/errors";
import { ORDER_STATUS, PAYMENT } from "@/components/shop/labels";
import { useSession } from "@/components/shop/session-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { countLabel, formatDate, formatPrice } from "@/lib/format";
import type { CustomerOrderListItem, CustomerOrderPage, OrderState, OrderStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const PER_PAGE = 20;

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const s = ORDER_STATUS[status];
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium", s.tone, className)}>{s.label}</span>;
}

const TABS: { state: OrderState | null; label: string }[] = [
  { state: null, label: "Все" },
  { state: "open", label: "В работе" },
  { state: "completed", label: "Выполнены" },
  { state: "cancelled", label: "Отменены" },
];

/** The orders the user sees, newest first, by state, a page at a time («Показать ещё»). */
export function OrdersList() {
  const { keepSession } = useSession();
  const [state, setState] = useState<OrderState | null>(null);
  const [result, setResult] = useState<{ state: OrderState | null; page: CustomerOrderPage; items: CustomerOrderListItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const fetchPage = useCallback(
    (st: OrderState | null, page: number) =>
      keepSession().then(() => api<CustomerOrderPage>(`/api/orders?page=${page}&per_page=${PER_PAGE}${st ? `&state=${st}` : ""}`)),
    [keepSession],
  );

  useEffect(() => {
    let alive = true;
    fetchPage(state, 1).then(
      (page) => alive && setResult({ state, page, items: page.items }),
      (e: unknown) => alive && setError(errorMessage(e, "Не удалось загрузить заказы.")),
    );
    return () => {
      alive = false;
    };
  }, [fetchPage, state, attempt]);

  if (error && !result) {
    return (
      <LoadError
        message={error}
        onRetry={() => {
          setError(null);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  if (!result) return <AccountSkeleton />;

  const counts = result.page.counts;
  const all = counts.open + counts.completed + counts.cancelled;
  const current = result.state === state; // the tab's orders have arrived
  const more = current && result.items.length < result.page.total;
  return (
    <div className="max-w-4xl">
      <PageHeading
        title="Заказы"
        lead={all ? `${countLabel(all, ["заказ", "заказа", "заказов"])}, в работе — ${counts.open}` : "Здесь появятся заказы вашей организации."}
      />
      {all > 0 && (
        <div role="tablist" aria-label="Заказы по статусу" className="no-scrollbar -mx-1 mb-5 flex gap-1 overflow-x-auto px-1">
          {TABS.map((t) => {
            const n = t.state ? counts[t.state] : all;
            const active = state === t.state;
            return (
              <button
                key={t.label}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setState(t.state)}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-medium transition-colors",
                  active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t.label}
                <span className={cn("tabular-nums", active ? "opacity-70" : "text-muted-foreground/70")}>{n}</span>
              </button>
            );
          })}
        </div>
      )}
      {!current ? (
        <AccountSkeleton />
      ) : result.items.length ? (
        <>
          <ul className="space-y-2">
            {result.items.map((o) => (
              <li key={o.id}>
                <OrderRow order={o} />
              </li>
            ))}
          </ul>
          {more && (
            <Button
              variant="outline"
              className="mt-5 h-10 w-full gap-2 rounded-xl sm:w-auto sm:px-5"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                fetchPage(state, Math.floor(result.items.length / PER_PAGE) + 1)
                  .then((page) =>
                    setResult((r) => r && { ...r, page, items: [...r.items, ...page.items.filter((o) => !r.items.some((p) => p.id === o.id))] }),
                  )
                  .catch((e: unknown) => toast.error(errorMessage(e, "Не удалось загрузить заказы.")))
                  .finally(() => setLoadingMore(false));
              }}
            >
              {loadingMore && <LoaderCircle className="animate-spin" />}
              Показать ещё
            </Button>
          )}
        </>
      ) : all ? (
        <p className="rounded-3xl bg-muted/50 px-5 py-10 text-center text-sm text-muted-foreground">Здесь заказов нет.</p>
      ) : (
        <NoOrders />
      )}
    </div>
  );
}

export function OrderRow({ order: o }: { order: CustomerOrderListItem }) {
  return (
    <Link
      href={`/account/orders/${o.id}`}
      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-2xl border p-4 transition-colors outline-none hover:border-foreground/25 focus-visible:ring-3 focus-visible:ring-ring/50 sm:grid-cols-[9rem_minmax(0,1fr)_auto_auto]"
    >
      <div>
        <p className="font-semibold tabular-nums">№ {o.number}</p>
        <p className="text-xs text-muted-foreground">{formatDate(o.created_at)}</p>
      </div>
      <div className="col-start-1 row-start-2 min-w-0 sm:col-start-2 sm:row-start-1">
        <OrderStatusBadge status={o.status} />
        {o.buyer_name && (
          <p className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <Building2 className="size-3.5 shrink-0" />
            <span className="truncate">{o.buyer_name}</span>
          </p>
        )}
      </div>
      <div className="row-span-2 text-right sm:row-span-1">
        <p className="font-semibold tracking-tight tabular-nums">{formatPrice(o.total)}</p>
        <p className="text-xs text-muted-foreground">
          {o.items_count} шт. · {PAYMENT[o.payment_method].title.toLowerCase()}
        </p>
      </div>
      <ChevronRight className="hidden size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
    </Link>
  );
}

function NoOrders() {
  return (
    <div className="flex flex-col items-center rounded-3xl bg-muted/50 px-6 py-14 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-background shadow-xs">
        <Package className="size-6 text-muted-foreground" />
      </span>
      <p className="mt-5 text-lg font-semibold">Заказов пока нет</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">Оформленные заказы и их статусы появятся здесь.</p>
      <Link href="/catalog" className={cn(buttonVariants({ size: "lg" }), "mt-6 h-11 rounded-xl px-5")}>
        Перейти в каталог
      </Link>
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-3xl bg-muted/50 px-6 py-14 text-center">
      <p className="text-lg font-semibold">{message}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">Проверьте подключение к интернету и попробуйте ещё раз.</p>
      <Button variant="outline" className="mt-5 h-10 rounded-xl px-4" onClick={onRetry}>
        Повторить
      </Button>
    </div>
  );
}
