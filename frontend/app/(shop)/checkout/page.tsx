import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { CheckoutView } from "@/components/shop/checkout-view";
import { getShop } from "@/lib/catalog";

export const metadata: Metadata = { title: "Оформление заказа", robots: { index: false } };

// A static shell like the cart: the order is made of the visitor's cart, loaded in the browser.
export default function CheckoutPage() {
  return (
    <div className="container-shop pt-5 sm:pt-8">
      <h1 className="mb-6 text-[26px] leading-tight font-semibold tracking-tight sm:mb-8 sm:text-3xl">Оформление заказа</h1>
      <CheckoutView
        pickup={
          <Suspense fallback={null}>
            <PickupAddress />
          </Suspense>
        }
      />
    </div>
  );
}

async function PickupAddress() {
  await connection(); // shop settings are runtime data: never fetched at build time
  const { address, working_hours } = await getShop();
  if (!address) return null;
  return (
    <>
      {address}
      {working_hours && <span className="block text-muted-foreground">{working_hours}</span>}
    </>
  );
}
