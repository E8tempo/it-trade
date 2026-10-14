"use client";

import { Building2, Clock, LockKeyhole } from "lucide-react";
import Link from "next/link";

import { useBuyerPrices } from "@/components/shop/buyer-prices";
import { authHref } from "@/components/shop/next-url";
import { useCart, useSession } from "@/components/shop/session-provider";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The product's price for the client's organization, for cash and, when it differs, cashless. A guest sees how to
 * get prices; a client whose organization is being checked, that they are coming.
 */
export function ProductPrice({ sku, path }: { sku: number; path: string }) {
  const { access } = useSession();
  const { cart } = useCart();
  const buyer = useBuyerPrices(sku);

  if (buyer?.loading) {
    return (
      <div className="space-y-2" aria-busy>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>
    );
  }
  if (buyer) {
    const { cash, cashless } = buyer.prices ?? { cash: null, cashless: null };
    return (
      <>
        {cart && (
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-primary">
            <Building2 className="size-3.5" />
            <span className="truncate">Цена для {cart.organization.name}</span>
          </p>
        )}
        <p className="text-[32px] leading-none font-semibold tracking-tight tabular-nums">{formatPrice(cash)}</p>
        {cash != null && cashless != null && cashless !== cash && (
          <p className="text-sm text-muted-foreground">
            Безналичный расчёт: <span className="font-medium text-foreground tabular-nums">{formatPrice(cashless)}</span>
          </p>
        )}
      </>
    );
  }
  if (access === "pending") {
    return (
      <div className="flex gap-3 rounded-2xl bg-amber-500/10 p-4 text-sm">
        <Clock className="mt-0.5 size-5 shrink-0 text-amber-700" />
        <p>
          <span className="font-medium">Цены откроются после проверки организации.</span>{" "}
          <Link href="/account/organizations" className="text-primary hover:underline">
            Статус проверки
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-2xl bg-muted/60 p-4">
      <p className="flex gap-2.5 text-sm">
        <LockKeyhole className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>
          <span className="font-medium">Цены и заказ — для компаний-клиентов.</span> Зарегистрируйте организацию: после проверки
          откроются оптовые цены.
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/register" className={cn(buttonVariants(), "h-10 rounded-xl px-4")}>
          Стать клиентом
        </Link>
        <Link href={authHref("/login", path)} className={cn(buttonVariants({ variant: "outline" }), "h-10 rounded-xl px-4")}>
          Войти
        </Link>
      </div>
    </div>
  );
}
