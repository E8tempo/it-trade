import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Pager, SearchInput } from "@/components/admin/list-controls";
import { OrdersTable } from "@/components/admin/orders/orders-table";
import { PageHeader, Panel } from "@/components/admin/ui";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ORDER_STATUSES } from "@/lib/admin/labels";
import type { OrderPage, OrderStatus } from "@/lib/admin/types";
import { apiServer } from "@/lib/api/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Заказы" };

type Props = PageProps<"/admin/orders">;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function OrdersPage({ searchParams }: Props) {
  return (
    <>
      <PageHeader
        title="Заказы"
        description="Заказы с сайта и принятые по телефону. Нажмите на заказ, чтобы изменить статус, состав или данные покупателя."
        actions={
          <Link href="/admin/orders/new" className={buttonVariants()}>
            Новый заказ
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <OrdersContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function OrdersContent({ searchParams }: Pick<Props, "searchParams">) {
  const sp = await searchParams;
  const status = one(sp.status) as OrderStatus | undefined;
  const q = one(sp.q);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const query = new URLSearchParams({ page: String(page), per_page: "30" });
  if (status) query.set("status", status);
  if (q) query.set("q", q);
  const data = await apiServer<OrderPage>(`/api/admin/orders?${query}`);
  const all = Object.values(data.counts).reduce((a, b) => a + (b ?? 0), 0);

  const tab = (value: OrderStatus | undefined, label: string, count: number) => {
    const params = new URLSearchParams();
    if (value) params.set("status", value);
    if (q) params.set("q", q);
    const active = status === value;
    return (
      <Link
        key={value ?? "all"}
        href={`/admin/orders${params.size ? `?${params}` : ""}`}
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
          active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {label}
        <span className={cn("tabular-nums", active ? "opacity-80" : "text-muted-foreground/70")}>{count}</span>
      </Link>
    );
  };

  return (
    <Panel>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
          {tab(undefined, "Все", all)}
          {ORDER_STATUSES.map((s) => tab(s.value, s.label, data.counts[s.value] ?? 0))}
        </div>
        <SearchInput placeholder="Номер, телефон, имя или e-mail" />
      </div>
      <OrdersTable orders={data.items} />
      <Pager page={data.page} perPage={data.per_page} total={data.total} />
    </Panel>
  );
}
