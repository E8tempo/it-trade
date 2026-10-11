import type { Metadata } from "next";

import { NewOrderForm } from "@/components/admin/orders/new-order-form";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Новый заказ" };

export default function NewOrderPage() {
  return (
    <>
      <PageHeader
        title="Новый заказ"
        description="Заказ по телефону или в мессенджере. Цены подставляются из каталога, их можно изменить для этого заказа."
      />
      <NewOrderForm />
    </>
  );
}
