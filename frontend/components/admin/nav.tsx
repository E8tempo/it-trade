"use client";

import {
  BookOpen,
  Building2,
  ChevronRight,
  Megaphone,
  ExternalLink,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  ShoppingBag,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useState, useSyncExternalStore, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SUPPLIERS, supplierSections } from "@/lib/admin/suppliers";
import type { AdminUser } from "@/lib/admin/types";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

// `exact`: active on that very page only (a supplier's prices, not its other sections under the same path)
type NavLink = { href: string; label: string; icon?: LucideIcon; exact?: boolean };
// a group opens and closes; it holds links and groups (suppliers, each with its sections). `open`: open
// unless the admin closed it; the others are open while they hold the current page.
type NavGroup = { id: string; group: string; icon?: LucideIcon; links: NavEntry[]; open?: boolean };
type NavEntry = NavLink | NavGroup;

// The panel by kind of work: clients and their orders, the catalog and its suppliers, the system.
const NAV: NavEntry[] = [
  {
    id: "sales",
    group: "Продажи",
    open: true,
    links: [
      { href: "/admin", label: "Обзор", icon: LayoutDashboard, exact: true },
      { href: "/admin/orders", label: "Заказы", icon: ShoppingBag },
      { href: "/admin/organizations", label: "Клиенты", icon: Building2 },
      { href: "/admin/posts", label: "Новости и акции", icon: Megaphone },
    ],
  },
  {
    id: "catalog",
    group: "Каталог",
    open: true,
    links: [
      { href: "/admin/products", label: "Товары и цены", icon: Package },
      {
        id: "suppliers",
        group: "Поставщики",
        icon: Warehouse,
        links: SUPPLIERS.map((s) => ({
          id: `supplier:${s.code}`,
          group: s.name,
          links: supplierSections(s.code).map((section, i) => ({ ...section, exact: i === 0 })),
        })),
      },
    ],
  },
  {
    id: "system",
    group: "Система",
    open: true,
    links: [
      { href: "/admin/lab", label: "Лаборатория", icon: FlaskConical },
      { href: "/admin/docs", label: "Как это работает", icon: BookOpen },
      { href: "/admin/settings", label: "Настройки", icon: Settings },
    ],
  },
];

/** The current page is only known at request time on dynamic routes, so it streams in. */
function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Suspense fallback={<NavList pathname={null} onNavigate={onNavigate} />}>
      <ActiveNavLinks onNavigate={onNavigate} />
    </Suspense>
  );
}

function ActiveNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return <NavList pathname={usePathname()} onNavigate={onNavigate} />;
}

const isActive = ({ href, exact }: NavLink, pathname: string | null) =>
  pathname != null && (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

const containsActive = (entry: NavEntry, pathname: string | null): boolean =>
  "group" in entry ? entry.links.some((e) => containsActive(e, pathname)) : isActive(entry, pathname);

// Groups the admin opened or closed, kept between visits; the others are open while they hold the current page.
const OPEN_KEY = "admin:nav-open";
const openListeners = new Set<() => void>();

function readOpen(): string {
  try {
    return localStorage.getItem(OPEN_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}

function saveOpen(id: string, open: boolean) {
  let state: Record<string, boolean> = {};
  try {
    state = JSON.parse(readOpen());
  } catch {
    // a broken value starts afresh
  }
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify({ ...state, [id]: open }));
  } catch {
    // not remembered, works until the page is reloaded
  }
  openListeners.forEach((listener) => listener());
}

function subscribeOpen(listener: () => void): () => void {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

// depth 0: the kinds of work; 1: their pages (and «Поставщики»); 2: the suppliers; 3: a supplier's sections
const INDENT = ["px-2.5", "px-2.5", "pr-2.5 pl-9", "pr-2.5 pl-13"];

function NavList({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  const stored = useSyncExternalStore(subscribeOpen, readOpen, () => "{}");
  let opened: Record<string, boolean> = {};
  try {
    opened = JSON.parse(stored);
  } catch {
    // ignore a broken value
  }

  const render = (entry: NavEntry, depth: number): ReactNode => {
    if (!("group" in entry)) {
      const { href, label, icon: Icon } = entry;
      const active = isActive(entry, pathname);
      return (
        <Link
          key={href}
          href={href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-lg py-2 text-sm transition-colors",
            INDENT[depth],
            active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {Icon && <Icon className="size-4" />}
          {label}
        </Link>
      );
    }
    const { id, group, icon: Icon, links } = entry;
    const open = opened[id] ?? (entry.open || containsActive(entry, pathname));
    return (
      // the list renders twice (sidebar and the phone menu), so the group is labelled without an id
      <div key={id} role="group" aria-label={group} className={cn("flex flex-col gap-0.5", depth === 0 && "mb-2")}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => saveOpen(id, !open)}
          className={cn(
            "flex items-center gap-2.5 rounded-lg py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            INDENT[depth],
            depth === 0 && "py-1.5 text-xs font-semibold tracking-wide uppercase",
            !open && containsActive(entry, pathname) && "font-medium text-primary",
          )}
        >
          {Icon && <Icon className="size-4" />}
          <span className="flex-1">{group}</span>
          <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
        </button>
        {open && links.map((l) => render(l, depth + 1))}
      </div>
    );
  };

  return <nav className="flex flex-col gap-0.5">{NAV.map((entry) => render(entry, 0))}</nav>;
}

function Brand() {
  return (
    <Link href="/admin" className="flex items-center gap-2 px-2.5 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">IT</span>
      <span>Панель управления</span>
    </Link>
  );
}

/** Desktop sidebar; on narrow screens the same links open from the top bar. */
export function AdminSidebar() {
  return (
    <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col gap-6 border-r bg-background p-3 lg:flex">
      <div className="pt-2">
        <Brand />
      </div>
      <NavLinks />
      <a
        href="/"
        target="_blank"
        className="mt-auto flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ExternalLink className="size-4" />
        Открыть сайт
      </a>
    </aside>
  );
}

export function AdminTopbar({ user }: { user: AdminUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-8">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon" className="lg:hidden" aria-label="Меню" />}>
          <Menu />
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-3">
          <SheetHeader className="px-0">
            <SheetTitle render={<div />}>
              <Brand />
            </SheetTitle>
          </SheetHeader>
          <NavLinks onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="ml-auto flex items-center gap-3 text-sm">
        <span className="hidden text-muted-foreground sm:inline">{user.name || user.email}</span>
        <Button variant="outline" size="sm" onClick={logout}>
          <LogOut />
          Выйти
        </Button>
      </div>
    </header>
  );
}
