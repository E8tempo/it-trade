import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { OrdersTable } from "@/components/admin/orders/orders-table";
import { PageHeader, Panel, Stat, StatusBadge } from "@/components/admin/ui";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money, ORDER_STATUSES, variantLabel, when } from "@/lib/admin/labels";
import type { Dashboard } from "@/lib/admin/types";
import { apiServer } from "@/lib/api/server";
import { formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Обзор" };

const JOBS: Record<string, string> = {
  categories: "Дерево категорий",
  products: "Каталог товаров",
  stock: "Цены и остатки",
  image_lists: "Списки фото",
};

const IMAGE_STATUS: Record<string, string> = {
  ready: "Готовы",
  stale: "В очереди на переобработку",
  pending: "Ждут обработки",
  failed: "Ошибка",
};

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Обзор"
        description="Что происходит в магазине: заказы, каталог, обработка фото и синхронизация с поставщиком."
        actions={
          <Link href="/admin/orders/new" className={buttonVariants()}>
            Новый заказ
          </Link>
        }
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  );
}

async function DashboardContent() {
  const d = await apiServer<Dashboard>("/api/admin/dashboard");
  const imagesTotal = Object.values(d.images.by_status).reduce((a, b) => a + b, 0);
  const variants = Object.entries(d.images.by_variant).sort((a, b) => b[1] - a[1]);
  const maxVariant = Math.max(1, ...variants.map(([, n]) => n));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Открытые заказы" value={formatNumber(d.orders.open)} hint="все, кроме выполненных и отменённых" href="/admin/orders" />
        <Stat label="Выручка за 30 дней" value={money(d.orders.revenue_30d)} hint={`${d.orders.completed_30d} выполненных заказов`} />
        <Stat label="Наценка за 30 дней" value={money(d.orders.margin_30d)} hint="выручка минус закупка" />
        <Stat
          label="Товаров в наличии"
          value={formatNumber(d.products.in_stock)}
          hint={`из ${formatNumber(d.products.active)} в каталоге`}
          href="/admin/products"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title="Последние заказы"
          action={
            <Link href="/admin/orders" className="text-sm text-primary hover:underline">
              Все заказы
            </Link>
          }
        >
          <OrdersTable orders={d.recent_orders} />
        </Panel>

        <Panel title="Заказы по статусам">
          <ul className="space-y-2">
            {ORDER_STATUSES.map((s) => (
              <li key={s.value} className="flex items-center justify-between gap-3">
                <Link href={`/admin/orders?status=${s.value}`} className="hover:underline">
                  <StatusBadge status={s.value} />
                </Link>
                <span className="tabular-nums">{d.orders.by_status[s.value] ?? 0}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Фото товаров"
          action={
            <Link href="/admin/loading" className="text-sm text-primary hover:underline">
              Загрузка каталога
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {Object.entries(IMAGE_STATUS).map(([k, label]) => (
              <div key={k}>
                <p className="text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold tabular-nums">{formatNumber(d.images.by_status[k] ?? 0)}</p>
              </div>
            ))}
          </div>
          <h3 className="mt-6 mb-3 text-sm font-medium">Какой знак был снят</h3>
          <ul className="space-y-1.5 text-sm">
            {variants.map(([v, n]) => (
              <li key={v} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3">
                <span className="truncate text-muted-foreground">{variantLabel(v)}</span>
                <span className="h-2 rounded-full bg-primary/15">
                  <span className="block h-2 rounded-full bg-primary" style={{ width: `${(100 * n) / maxVariant}%` }} />
                </span>
                <span className="tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">Всего фото: {formatNumber(imagesTotal)}.</p>
        </Panel>

        <Panel title="Каталог">
          <dl className="space-y-2 text-sm">
            {(
              [
                ["В каталоге поставщика", d.products.active],
                ["В наличии", d.products.in_stock],
                ["Скрыто вручную", d.products.hidden],
                ["С фиксированной ценой", d.products.fixed_price],
                ["В наличии без цены", d.products.in_stock_without_price],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{formatNumber(n)}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="Синхронизация с поставщиком" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-4 font-normal">Задача</th>
                  <th className="py-1.5 pr-4 font-normal">Последний запуск</th>
                  <th className="py-1.5 pr-4 font-normal">Последний успех</th>
                  <th className="py-1.5 font-normal">Результат</th>
                </tr>
              </thead>
              <tbody>
                {d.jobs.map((j) => (
                  <tr key={j.name} className="border-t align-top">
                    <td className="py-2 pr-4 font-medium">{JOBS[j.name] ?? j.name}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{when(j.last_started_at)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{when(j.last_success_at)}</td>
                    <td className="py-2 text-muted-foreground">
                      {j.last_error ? (
                        <span className="text-destructive">{j.last_error}</span>
                      ) : (
                        Object.entries(j.info)
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(", ") || "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
