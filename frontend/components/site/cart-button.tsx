"use client";

import { ShoppingCart } from "lucide-react";
import Link from "next/link";

import { useCart } from "@/components/shop/session-provider";
import { HEADER_ACTION } from "@/components/site/header-action";
import { countLabel } from "@/lib/format";

/** Link to the cart with the number of lines on a badge. */
export function CartButton() {
  const { cart, qty } = useCart();
  // lines being removed already drop out of the count
  const lines = cart ? cart.items.reduce((n, i) => n + (qty(i.sku) > 0 ? 1 : 0), 0) : 0;
  return (
    <Link href="/cart" className={HEADER_ACTION} aria-label={lines ? `Корзина: ${countLabel(lines)}` : "Корзина"}>
      <span className="relative">
        <ShoppingCart className="size-5" />
        {lines > 0 && (
          <span
            className="absolute -top-2 -right-2.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[11px] leading-none font-semibold text-primary-foreground tabular-nums ring-2 ring-background animate-in zoom-in-50"
            aria-hidden
          >
            {lines > 99 ? "99+" : lines}
          </span>
        )}
      </span>
      <span className="hidden lg:inline">Корзина</span>
    </Link>
  );
}
