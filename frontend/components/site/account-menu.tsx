"use client";

import { Lock, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { errorMessage } from "@/components/shop/errors";
import { authHref } from "@/components/shop/next-url";
import { useSession } from "@/components/shop/session-provider";
import { CartButton } from "@/components/site/cart-button";
import { CLIENT_NAV } from "@/components/site/client-panel";
import { HEADER_ACTION } from "@/components/site/header-action";
import { MenuLink } from "@/components/site/menu-link";
import { OrgSwitcher } from "@/components/site/org-switcher";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * The right of the header. A guest: «Войти» (coming back to this page) and «Стать клиентом». A client: the cart,
 * and a menu with their sections (the side panel's, for phones); on phones also the organization switch.
 */
export function AccountMenu() {
  const { user, access, logout } = useSession();
  const pathname = usePathname();
  const query = useSearchParams().toString();

  if (access === "loading") return <AccountMenuFallback />;

  if (!user) {
    const here = pathname + (query ? `?${query}` : "");
    // the auth pages already carry their own ?next=
    const onAuth = pathname === "/login" || pathname === "/register";
    return (
      <>
        <Link href={onAuth ? `/login${query ? `?${query}` : ""}` : authHref("/login", here)} className={HEADER_ACTION} aria-label="Войти">
          <UserRound className="size-5" />
          <span className="hidden sm:inline">Войти</span>
        </Link>
        <Link href="/register" className={cn(buttonVariants(), "ml-1 h-10 rounded-xl px-3.5 max-sm:hidden")}>
          Стать клиентом
        </Link>
      </>
    );
  }

  const firstName = user.name?.trim().split(/\s+/)[0];
  return (
    <>
      <span className="lg:hidden">
        <OrgSwitcher variant="icon" />
      </span>
      {access === "client" && <CartButton />}
      <DropdownMenu>
        <DropdownMenuTrigger className={HEADER_ACTION} aria-label={`Кабинет: ${user.name || user.email}`}>
          <UserRound className="size-5" />
          <span className="hidden max-w-28 truncate lg:inline">{firstName || "Кабинет"}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="w-64 rounded-xl p-1.5">
          <div className="px-2.5 pt-1.5 pb-2">
            <p className="truncate text-sm font-medium">{user.name || "Кабинет"}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <DropdownMenuSeparator />
          {CLIENT_NAV.filter((i) => i.href && i.href !== "/catalog").map(({ href, label, icon, clientOnly }) =>
            clientOnly && access !== "client" ? (
              <DropdownMenuItem key={label} disabled className="gap-2.5 rounded-lg px-2.5 py-2">
                <Lock className="text-muted-foreground" />
                {label}
              </DropdownMenuItem>
            ) : (
              <MenuLink key={label} href={href!} icon={icon}>
                {label}
              </MenuLink>
            ),
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2.5 rounded-lg px-2.5 py-2"
            onClick={() => logout().catch((e: unknown) => toast.error(errorMessage(e, "Не удалось выйти. Попробуйте ещё раз.")))}
          >
            <LogOut className="text-muted-foreground" />
            Выйти
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Until the session is known: the same footprint, nothing to click yet. */
export function AccountMenuFallback() {
  return (
    <span className={cn(HEADER_ACTION, "pointer-events-none text-muted-foreground/60")} aria-hidden>
      <UserRound className="size-5" />
      <span className="invisible hidden sm:inline">Войти</span>
    </span>
  );
}
