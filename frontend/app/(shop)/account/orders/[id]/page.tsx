import type { Metadata } from "next";
import { Suspense } from "react";

import { AccountSkeleton, SignedIn } from "@/components/account/account-shell";
import { CustomerOrderView } from "@/components/account/order-view";

type Props = PageProps<"/account/orders/[id]">;

// static: a title from `params` would keep the page from being prefetched
export const metadata: Metadata = { title: "Заказ" };

// the id is runtime data: the order itself is loaded in the browser
export default function AccountOrderPage({ params }: Props) {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <OrderLoader params={params} />
    </Suspense>
  );
}

async function OrderLoader({ params }: Pick<Props, "params">) {
  const { id } = await params;
  return (
    <SignedIn>
      <CustomerOrderView id={id} />
    </SignedIn>
  );
}
