"use client";

import { useBuyerPrices } from "@/components/shop/buyer-prices";
import { useSession } from "@/components/shop/session-provider";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The card's price: the client organization's one; a guest sees that prices are for clients (`quiet`: nothing). */
export function CardPrice({ sku, quiet, className }: { sku: number; quiet?: boolean; className?: string }) {
  const { access } = useSession();
  const buyer = useBuyerPrices(sku);
  if (buyer?.loading) {
    return (
      <span className={cn(className, "flex items-center")} aria-busy>
        <span className="h-[1.1em] w-20 animate-pulse rounded-md bg-muted" />
      </span>
    );
  }
  if (buyer) return <span className={className}>{formatPrice(buyer.prices?.cash)}</span>;
  if (quiet) return null;
  return (
    <span className="text-[13px] leading-6 font-medium text-muted-foreground">
      {access === "pending" ? "Цена — после проверки" : "Цена — для клиентов"}
    </span>
  );
}
