"use client";

import { Check, LoaderCircle, ShoppingCartPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useBuyerPrices } from "@/components/shop/buyer-prices";
import { errorMessage } from "@/components/shop/errors";
import { NOT_ADDED } from "@/components/shop/labels";
import { useCart } from "@/components/shop/session-provider";
import { cn } from "@/lib/utils";

const BUTTON =
  "grid h-10 min-w-10 place-items-center rounded-xl px-2.5 shadow-sm ring-1 ring-foreground/5 transition outline-none focus-visible:ring-3 focus-visible:ring-ring/60 active:scale-95";

/**
 * "Add to cart" on a product card: one pack (the API rounds up to the multiplicity). Once the
 * product is in the cart it shows the quantity and leads to the cart. Only for a client, for a
 * product with a price.
 */
export function CardCartButton({ sku, name, className }: { sku: number; name: string; className?: string }) {
  const { qty, add } = useCart();
  const buyer = useBuyerPrices(sku);
  const [adding, setAdding] = useState(false);
  const inCart = qty(sku);
  if (!buyer || buyer.loading || buyer.prices?.cash == null) return null;

  if (inCart > 0) {
    return (
      <Link
        href="/cart"
        aria-label={`${name}: в корзине ${inCart} шт. Перейти в корзину`}
        className={cn(BUTTON, "bg-primary text-primary-foreground hover:bg-primary/90", className)}
      >
        <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
          <Check className="size-4" strokeWidth={2.5} />
          {inCart}
        </span>
      </Link>
    );
  }

  async function onAdd() {
    setAdding(true);
    try {
      const cart = await add([{ sku, qty: 1 }]);
      const refused = cart.not_added.find((n) => n.sku === sku);
      if (refused) toast.error(NOT_ADDED[refused.reason]);
    } catch (e) {
      toast.error(errorMessage(e, "Не удалось добавить товар в корзину"));
    } finally {
      setAdding(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={adding}
      aria-label={`В корзину: ${name}`}
      className={cn(BUTTON, "bg-background text-foreground hover:bg-primary hover:text-primary-foreground disabled:opacity-80", className)}
    >
      {adding ? <LoaderCircle className="size-[18px] animate-spin" /> : <ShoppingCartPlus className="size-[18px]" />}
    </button>
  );
}
