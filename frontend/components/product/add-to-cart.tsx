"use client";

import { ArrowRight, CircleCheck, LoaderCircle, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useBuyerPrices } from "@/components/shop/buyer-prices";
import { errorMessage } from "@/components/shop/errors";
import { NOT_ADDED } from "@/components/shop/labels";
import { QtyStepper } from "@/components/shop/qty-stepper";
import { useCart } from "@/components/shop/session-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const ACTION = "h-11 min-w-0 flex-1 gap-2 rounded-xl text-[15px]";

/**
 * Quantity (whole packs) and «В корзину». Once the product is in the cart the stepper edits the
 * cart's line directly, and the button leads to the cart. Only for a client, for a product with a price.
 */
export function AddToCart({ sku, name, multiplicity }: { sku: number; name: string; multiplicity: number }) {
  const { qty, add, setQty } = useCart();
  const buyer = useBuyerPrices(sku);
  const step = Math.max(1, multiplicity);
  const [amount, setAmount] = useState(step);
  const [adding, setAdding] = useState(false);
  const inCart = qty(sku);
  if (!buyer || buyer.loading || buyer.prices?.cash == null) return null;

  async function onAdd() {
    setAdding(true);
    try {
      const cart = await add([{ sku, qty: amount }]);
      const refused = cart.not_added.find((n) => n.sku === sku);
      if (refused) toast.error(NOT_ADDED[refused.reason]);
      else setAmount(step); // for the next time, after it leaves the cart
    } catch (e) {
      toast.error(errorMessage(e, "Не удалось добавить товар в корзину"));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        {inCart > 0 ? (
          <>
            <QtyStepper value={inCart} step={step} onChange={(q) => setQty(sku, q)} removable size="lg" label={`В корзине: ${name}`} />
            <Link href="/cart" className={cn(buttonVariants(), ACTION)}>
              Перейти в корзину
              <ArrowRight className="size-4" />
            </Link>
          </>
        ) : (
          <>
            <QtyStepper value={amount} step={step} onChange={setAmount} size="lg" label={`Количество: ${name}`} />
            <Button className={ACTION} onClick={onAdd} disabled={adding}>
              {adding ? <LoaderCircle className="size-[18px] animate-spin" /> : <ShoppingCart className="size-[18px]" />}В корзину
            </Button>
          </>
        )}
      </div>
      {/* below the buttons, so they stay under the finger; announced to screen readers */}
      <div aria-live="polite">
        {inCart > 0 && (
          <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-700">
            <CircleCheck className="size-4" />В корзине — {formatNumber(inCart)} шт.
          </p>
        )}
      </div>
    </div>
  );
}
