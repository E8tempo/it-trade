import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { OrderEditor } from "@/components/admin/orders/order-editor";
import { PageHeader } from "@/components/admin/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/admin/labels";
import type { Order } from "@/lib/admin/types";
import { ApiError, apiServer } from "@/lib/api/server";

type Props = PageProps<"/admin/orders/[id]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Заказ ${(await params).id.padStart(6, "0")}` };
}

async function loadOrder(params: Props["params"]): Promise<Order> {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  let order: Order | null = null;
  try {
    order = await apiServer<Order>(`/api/admin/orders/${id}`);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  if (!order) notFound();
  return order;
}

export default function OrderPage({ params }: Props) {
  return (
    <>
      <Link href="/admin/orders" className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground">
        ← Все заказы
      </Link>
      <Suspense fallback={<OrderSkeleton />}>
        <OrderContent params={params} />
      </Suspense>
    </>
  );
}

async function OrderContent({ params }: Pick<Props, "params">) {
  const order = await loadOrder(params);
  return (
    <>
      <PageHeader
        title={`Заказ ${order.number}`}
        description={
          <>
            {order.customer_name}, {order.phone} · на сумму <span className="font-medium text-foreground">{money(order.total)}</span>
          </>
        }
      />
      <OrderEditor order={order} />
    </>
  );
}

function OrderSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}
