import type { Metadata } from "next";

import { SignedIn } from "@/components/account/account-shell";
import { OrdersList } from "@/components/account/orders-view";

export const metadata: Metadata = { title: "Мои заказы" };

export default function AccountOrdersPage() {
  return (
    <SignedIn>
      <OrdersList />
    </SignedIn>
  );
}
