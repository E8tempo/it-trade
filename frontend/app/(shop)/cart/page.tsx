import type { Metadata } from "next";

import { CartView } from "@/components/shop/cart-view";

export const metadata: Metadata = { title: "Корзина", robots: { index: false } };

// The cart is the visitor's own: the page is a static shell, the lines are loaded in the browser.
export default function CartPage() {
  return (
    <div className="container-shop pt-5 sm:pt-8">
      <CartView />
    </div>
  );
}
