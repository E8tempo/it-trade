"use client";

import {
  Building2,
  FileText,
  House,
  LayoutGrid,
  Lock,
  LogOut,
  Package,
  ShoppingCart,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/components/shop/errors";
import { useCart, useSession, type Access } from "@/components/shop/session-provider";
import { OrgSwitcher } from "@/components/site/org-switcher";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type ClientNavItem = {
  label: string;
  icon: LucideIcon;
  href?: string; // none: coming in a later stage
  /** the item is current on these paths too (the catalog's categories, products, search) */
  match?: RegExp;
  /** only a client of an approved organization may open it */
  clientOnly?: boolean;
};

// The client's sections. Later stages fill in the ones without a link.
export const CLIENT_NAV: ClientNavItem[] = [
  { label: "Главная", icon: House, href: "/" },
  { label: "Каталог", icon: LayoutGrid, href: "/catalog", match: /^\/(catalog|c|p|search)(\/|$)/ },
  { label: "Корзина", icon: ShoppingCart, href: "/cart", match: /^\/(cart|checkout)(\/|$)/, clientOnly: true },
  { label: "Заказы", icon: Package, href: "/account/orders", clientOnly: true },
  { label: "КП для клиентов", icon: FileText },
  { label: "Взаиморасчёты", icon: Wallet },
  { label: "Организации", icon: Building2, href: "/account/organizations" },
  { label: "Профиль", icon: UserRound, href: "/account", match: /^\/account$/ },
];

export function isCurrent(item: ClientNavItem, pathname: string | null): boolean {
  if (pathname == null || !item.href) return false;
  if (item.match) return item.match.test(pathname);
  return item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * The client's side panel, from lg up: the organization they work for and their sections. It shows from the first
 * paint for a visitor who was signed in (the `authed:` variant), with a skeleton until the session is known.
 */
export function ClientSidebar() {
  return (
    <aside
      aria-label="Кабинет клиента"
      className="sticky top-(--header-h) hidden h-[calc(100svh-var(--header-h))] w-64 shrink-0 self-start flex-col gap-4 overflow-y-auto border-r bg-muted/25 p-3 authed:lg:flex"
    >
      <PanelContent />
    </aside>
  );
}

function PanelContent() {
  const { user, access, logout } = useSession();
  if (access === "loading" || !user) {
    return (
      <div className="space-y-3" aria-hidden>
        <Skeleton className="h-14 rounded-2xl" />
        {CLIENT_NAV.map((i) => (
          <Skeleton key={i.label} className="h-9 rounded-xl" />
        ))}
      </div>
    );
  }
  return (
    <>
      <OrgSwitcher variant="panel" />
      {/* the current page is only known at request time on dynamic routes, so it streams in */}
      <Suspense fallback={<NavList access={access} pathname={null} />}>
        <CurrentNavList access={access} />
      </Suspense>
      <div className="mt-auto border-t pt-3">
        <p className="truncate px-2.5 text-sm font-medium">{user.name || user.email}</p>
        {user.name && <p className="truncate px-2.5 text-xs text-muted-foreground">{user.email}</p>}
        <button
          type="button"
          onClick={() => logout().catch((e: unknown) => toast.error(errorMessage(e, "Не удалось выйти. Попробуйте ещё раз.")))}
          className="mt-2 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="size-4" />
          Выйти
        </button>
      </div>
    </>
  );
}

function CurrentNavList({ access }: { access: Access }) {
  return <NavList access={access} pathname={usePathname()} />;
}

const ITEM = "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors";

function NavList({ access, pathname }: { access: Access; pathname: string | null }) {
  const { cart, qty } = useCart();
  const lines = cart ? cart.items.reduce((n, i) => n + (qty(i.sku) > 0 ? 1 : 0), 0) : 0;
  return (
    <nav className="flex flex-col gap-0.5">
      {CLIENT_NAV.map((item) => {
        const { label, icon: Icon, href } = item;
        const locked = item.clientOnly && access !== "client";
        if (!href || locked) {
          return (
            <span
              key={label}
              className={cn(ITEM, "cursor-default text-muted-foreground/60")}
              title={locked ? "Откроется после подтверждения организации" : "Скоро"}
            >
              <Icon className="size-4" />
              <span className="flex-1">{label}</span>
              {locked ? (
                <Lock className="size-3.5" aria-label="после подтверждения организации" />
              ) : (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase">скоро</span>
              )}
            </span>
          );
        }
        const current = isCurrent(item, pathname);
        return (
          <Link
            key={label}
            href={href}
            aria-current={current ? "page" : undefined}
            className={cn(ITEM, current ? "bg-background font-medium text-foreground shadow-xs ring-1 ring-foreground/5" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            <Icon className={cn("size-4", current && "text-primary")} />
            <span className="flex-1">{label}</span>
            {href === "/cart" && lines > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
                {lines > 99 ? "99+" : lines}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
