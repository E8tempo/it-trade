"use client";

import { Building2, FileText, Package, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { authHref } from "@/components/shop/next-url";
import { useSession } from "@/components/shop/session-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The account's sections. Later stages add more of them here (settlements).
const TABS: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
  { href: "/account/orders", label: "Заказы", icon: Package },
  { href: "/account/quotes", label: "КП", icon: FileText },
  { href: "/account/organizations", label: "Организации", icon: Building2 },
  { href: "/account", label: "Профиль", icon: UserRound, exact: true },
];

/**
 * The account's frame: the sections' tabs on phones (the side panel has them from lg up); each page has its
 * own heading. Only for a signed-in customer: a guest goes to the login page, coming back here afterwards. The pages load their data in the browser, inside
 * <SignedIn> (the page segment itself is always rendered, as instant navigation expects).
 */
export function AccountGate({ tabs, children }: { tabs: ReactNode; children: ReactNode }) {
  const router = useRouter();
  const { user, loading } = useSession();

  useEffect(() => {
    if (!loading && !user) router.replace(authHref("/login", window.location.pathname + window.location.search));
  }, [loading, user, router]);

  return (
    <>
      {tabs}
      <div className="pt-6 sm:pt-8 lg:pt-2">{children}</div>
    </>
  );
}

/** A page's content once the customer is known (it loads their data); a skeleton until then. */
export function SignedIn({ children }: { children: ReactNode }) {
  const { user } = useSession();
  return user ? children : <AccountSkeleton />;
}

const TAB = "flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** The section links (the current one highlighted). Needs Suspense: a page may have a runtime param. */
export function AccountTabs() {
  const pathname = usePathname();
  return (
    // from lg up the side panel has the sections
    <nav aria-label="Разделы кабинета" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 lg:hidden">
      <ul className="flex gap-1 border-b pb-3">
        {TABS.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(TAB, active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AccountTabsFallback() {
  return (
    <div className="-mx-4 overflow-x-hidden px-4 sm:mx-0 sm:px-0 lg:hidden" aria-hidden>
      <div className="flex gap-1 border-b pb-3">
        {TABS.map(({ href, label, icon: Icon }) => (
          <span key={href} className={cn(TAB, "text-muted-foreground")}>
            <Icon className="size-4" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function AccountSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-7 w-56" />
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-2xl" />
      ))}
    </div>
  );
}

/** A page's heading: its title, what it is for, and its main action on the right. */
export function PageHeading({ title, lead, action }: { title: ReactNode; lead?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 sm:mb-8">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {lead && <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">{lead}</p>}
      </div>
      {action}
    </div>
  );
}
