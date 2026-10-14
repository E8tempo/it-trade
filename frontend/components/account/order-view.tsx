"use client";

import { ArrowLeft, Building2, CircleCheckBig, FileText, MessageSquare, Truck, UserRound, Wallet } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { AccountSkeleton, PageHeading } from "@/components/account/account-shell";
import { LoadError, OrderStatusBadge } from "@/components/account/orders-view";
import { ACCOUNT_CARD, CARD_HEAD, CardRow } from "@/components/account/ui";
import { useAccountData } from "@/components/account/use-account-data";
import { ProductImage } from "@/components/catalog/product-image";
import { errorMessage, hasStatus } from "@/components/shop/errors";
import { contractTerms, DELIVERY, ORDER_STATUS, PAYMENT } from "@/components/shop/labels";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { countLabel, formatDate, formatDateTime, formatNumber, formatPrice } from "@/lib/format";
import type { CustomerOrder } from "@/lib/types";
import { productHref } from "@/lib/urls";
import { cn } from "@/lib/utils";

const BACK = "mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground";

/** One of the customer's orders. `?placed=1`: it has just been placed at checkout. */
export function CustomerOrderView({ id }: { id: string }) {
  const placed = useSearchParams().get("placed") === "1";
  const valid = /^\d{1,10}$/.test(id);
  const { data: order, error, reload } = useAccountData<CustomerOrder>(`/api/orders/${valid ? id : "0"}`);

  if (!valid || hasStatus(error, 404, 422)) return <NotFound />;
  if (error) return <LoadError message={errorMessage(error, "Не удалось загрузить заказ.")} onRetry={reload} />;
  if (!order) return <AccountSkeleton />;

  const buyer = order.buyer;
  const units = order.items.reduce((n, i) => n + i.qty, 0);
  return (
    <div className="max-w-6xl">
      <Link href="/account/orders" className={BACK}>
        <ArrowLeft className="size-4" />
        Все заказы
      </Link>
      {placed && (
        <div role="status" className="mb-6 flex gap-3 rounded-2xl bg-emerald-500/10 p-4 text-sm text-emerald-900">
          <CircleCheckBig className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <p>
            <span className="font-semibold">Заказ №{order.number} оформлен.</span> Менеджер свяжется с вами для подтверждения.
          </p>
        </div>
      )}
      <PageHeading
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            Заказ №{order.number}
            <OrderStatusBadge status={order.status} className="text-sm" />
          </span>
        }
        lead={`от ${formatDate(order.created_at)}${buyer ? ` · ${buyer.name}` : ""}`}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <Card className={ACCOUNT_CARD}>
            <CardHeader className={CARD_HEAD}>
              <CardTitle className="text-base font-semibold">Товары</CardTitle>
              <CardDescription>
                {countLabel(order.items.length, ["позиция", "позиции", "позиций"])}, {formatNumber(units)} шт.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {order.items.map((item) => (
                  <li key={item.sku} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-3.5 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:gap-x-4">
                    <span className="block aspect-square overflow-hidden rounded-xl bg-muted/70 p-1.5">
                      <ProductImage image={item.image} alt="" sizes="64px" />
                    </span>
                    <div className="min-w-0">
                      {item.slug ? (
                        <Link href={productHref({ sku: item.sku, slug: item.slug })} className="line-clamp-2 text-sm leading-snug font-medium hover:text-primary">
                          {item.name}
                        </Link>
                      ) : (
                        <p className="line-clamp-2 text-sm leading-snug font-medium">{item.name}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                        Артикул <span className="font-mono">{item.sku}</span> · {formatNumber(item.qty)} × {formatPrice(item.price)}
                      </p>
                    </div>
                    <p className="text-right text-[15px] font-semibold tracking-tight tabular-nums">{formatPrice(item.total)}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {order.history.length > 0 && (
            <Card className={ACCOUNT_CARD}>
              <CardHeader className={CARD_HEAD}>
                <CardTitle className="text-base font-semibold">История</CardTitle>
              </CardHeader>
              <CardContent className="py-(--card-spacing)">
                <ol className="space-y-4 border-l pl-5">
                  {[...order.history].reverse().map((h, i) => (
                    <li key={`${h.at}-${i}`} className="relative text-sm">
                      <span className={cn("absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-card", i === 0 ? "bg-primary" : "bg-muted-foreground/40")} />
                      <p className={cn(i === 0 && "font-medium")}>{ORDER_STATUS[h.status].label}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(h.at)}</p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-[calc(var(--header-h)+1.5rem)] lg:self-start" aria-label="Детали заказа">
          <Card className={ACCOUNT_CARD}>
            <CardContent className="space-y-2 py-(--card-spacing) text-sm">
              <Row label="Товары">{formatPrice(order.items_total)}</Row>
              <Row label="Доставка">
                {order.delivery_price > 0 ? formatPrice(order.delivery_price) : order.delivery === "pickup" ? "бесплатно" : "уточнит менеджер"}
              </Row>
              {order.discount > 0 && <Row label="Скидка">−{formatPrice(order.discount)}</Row>}
              <div className="flex items-baseline justify-between gap-4 border-t pt-3">
                <span className="text-base font-semibold">Итого</span>
                <span className="text-2xl font-semibold tracking-tight tabular-nums">{formatPrice(order.total)}</span>
              </div>
            </CardContent>
          </Card>

          <Card className={ACCOUNT_CARD}>
            <CardHeader className={CARD_HEAD}>
              <CardTitle className="text-base font-semibold">Детали</CardTitle>
            </CardHeader>
            <CardContent>
              {buyer && (
                <CardRow icon={Building2} label="Организация">
                  {buyer.name}
                  <span className="block text-xs font-normal text-muted-foreground">
                    ИНН {buyer.inn}
                    {buyer.kpp && ` · КПП ${buyer.kpp}`}
                  </span>
                </CardRow>
              )}
              {buyer && (
                <CardRow icon={FileText} label="Договор">
                  {buyer.contract ? (
                    <>
                      № {buyer.contract.number} от {formatDate(buyer.contract.signed_on)}
                      <span className="block text-xs font-normal text-muted-foreground">{contractTerms(buyer.contract)}</span>
                    </>
                  ) : (
                    <span className="font-normal text-muted-foreground">без договора — условия уточнит менеджер</span>
                  )}
                </CardRow>
              )}
              <CardRow icon={Wallet} label="Оплата">
                {PAYMENT[order.payment_method].title}
              </CardRow>
              <CardRow icon={Truck} label="Получение">
                {DELIVERY[order.delivery]}
                {(order.city || order.address) && (
                  <span className="block text-xs font-normal text-muted-foreground">{[order.city, order.address].filter(Boolean).join(", ")}</span>
                )}
              </CardRow>
              <CardRow icon={UserRound} label="Контакты">
                {order.customer_name}
                <span className="block text-xs font-normal text-muted-foreground">{[order.phone, order.email].filter(Boolean).join(" · ")}</span>
              </CardRow>
              {order.comment && (
                <CardRow icon={MessageSquare} label="Комментарий">
                  <span className="font-normal">{order.comment}</span>
                </CardRow>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
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

function NotFound() {
  return (
    <div className="flex flex-col items-center rounded-3xl bg-muted/50 px-6 py-14 text-center">
      <p className="text-lg font-semibold">Заказ не найден</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">Возможно, он оформлен в другом аккаунте или ссылка неполная.</p>
      <Link href="/account/orders" className={cn(buttonVariants({ variant: "outline" }), "mt-5 h-10 rounded-xl px-4")}>
        Все заказы
      </Link>
    </div>
  );
}
