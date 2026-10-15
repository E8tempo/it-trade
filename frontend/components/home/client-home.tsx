"use client";

import { ArrowRight, Building2, CircleAlert, Clock, FileText, LayoutGrid, Package, Plus, ShoppingCart, UserRound, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { OrderRow } from "@/components/account/orders-view";
import { PostsList } from "@/components/home/posts-list";
import { useCart, useSession } from "@/components/shop/session-provider";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { countLabel, formatPrice } from "@/lib/format";
import type { CustomerOrderPage, Organization, Post } from "@/lib/types";
import { cn } from "@/lib/utils";

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("ru-RU", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Simferopol" }).format(new Date()));
  return h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
}

/**
 * The client's home page: whom they buy as and their organizations' checks, the cart, the latest orders with their
 * statuses, news and promotions. Rendered in the browser (the session is known there); a guest gets the landing
 * instead.
 */
export function ClientHome() {
  const { user, access, organizations, keepSession } = useSession();
  const [orders, setOrders] = useState<CustomerOrderPage | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);

  useEffect(() => {
    if (access !== "client") return;
    let alive = true;
    keepSession()
      .then(() => api<CustomerOrderPage>("/api/orders?per_page=5"))
      .then(
        (page) => alive && setOrders(page),
        () => undefined,
      );
    return () => {
      alive = false;
    };
  }, [access, keepSession]);

  useEffect(() => {
    let alive = true;
    api<Post[]>("/api/posts?limit=6").then(
      (p) => alive && setPosts(p),
      () => alive && setPosts([]),
    );
    return () => {
      alive = false;
    };
  }, []);

  if (access === "loading") return <HomeSkeleton />;
  if (!user) return null; // a guest: the landing is shown

  const firstName = user.name?.trim().split(/\s+/)[0];
  return (
    <div className="container-shop space-y-8 pt-6 pb-4 sm:pt-8">
      <div>
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight sm:text-3xl">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Кабинет клиента IT Trade: цены, корзина и заказы.</p>
      </div>

      {organizations && <OrganizationsNotice organizations={organizations} />}
      <ClientTiles orders={orders} organizations={organizations ?? []} />

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section>
          <SectionHead title="Последние заказы" href="/account/orders" link="Все заказы" />
          {!orders ? (
            <div className="space-y-2" aria-hidden>
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-[74px] rounded-2xl" />
              ))}
            </div>
          ) : orders.items.length ? (
            <ul className="space-y-2">
              {orders.items.map((o) => (
                <li key={o.id}>
                  <OrderRow order={o} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-3xl bg-muted/50 px-5 py-8 text-center text-sm text-muted-foreground">
              Заказов пока нет.{" "}
              <Link href="/catalog" className="font-medium text-primary hover:underline">
                Перейти в каталог
              </Link>
            </div>
          )}
        </section>
        <section>
          <SectionHead title="Новости и акции" />
          {!posts ? (
            <Skeleton className="h-40 rounded-3xl" />
          ) : posts.length ? (
            <PostsList posts={posts} className="sm:grid-cols-1 xl:grid-cols-1" />
          ) : (
            <p className="rounded-3xl bg-muted/50 px-5 py-8 text-center text-sm text-muted-foreground">Новостей пока нет.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function ClientTiles({ orders, organizations }: { orders: CustomerOrderPage | null; organizations: Organization[] }) {
  const { cart, payment } = useCart();
  const open = orders?.counts.open;
  const org = cart?.organization ? organizations.find((o) => o.id === cart.organization?.id) : null;
  const contracts = org?.contracts.filter((c) => c.is_active).length ?? 0;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        href="/cart"
        icon={ShoppingCart}
        label="Корзина"
        value={cart ? (cart.lines ? formatPrice(cart.totals[payment]) : "пусто") : "…"}
        hint={cart?.lines ? countLabel(cart.lines, ["позиция", "позиции", "позиций"]) : "добавьте товары из каталога"}
      />
      <Tile
        href="/account/orders"
        icon={Package}
        label="Заказы"
        value={orders ? String(orders.total) : "…"}
        hint={open ? `в работе: ${open}` : "все выполнены"}
      />
      {cart?.organization ? (
        <Tile
          href="/account/organizations"
          icon={Building2}
          label="Покупатель"
          value={cart.organization.name}
          hint={contracts ? countLabel(contracts, ["договор", "договора", "договоров"]) : "договор оформит менеджер"}
        />
      ) : (
        <Tile
          href="/account/organizations"
          icon={UserRound}
          label="Покупатель"
          value={cart ? "Физическое лицо" : "…"}
          hint={organizations.length ? "организация — в шапке сайта" : "цены для физ. лиц"}
        />
      )}
      <div className="flex flex-col justify-between gap-3 rounded-3xl bg-primary p-5 text-primary-foreground">
        <p className="flex items-center gap-2 text-sm font-medium opacity-90">
          <Zap className="size-4" />
          Быстрые действия
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/catalog" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-background/15 px-3 text-sm font-medium hover:bg-background/25">
            <LayoutGrid className="size-4" />
            Каталог
          </Link>
          {cart?.organization ? (
            <Link href="/account/quotes" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-background/15 px-3 text-sm font-medium hover:bg-background/25">
              <FileText className="size-4" />
              КП для клиента
            </Link>
          ) : (
            !organizations.length && (
              <Link
                href="/account/organizations?add=1"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-background/15 px-3 text-sm font-medium hover:bg-background/25"
              >
                <Plus className="size-4" />
                Организация
              </Link>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ href, icon: Icon, label, value, hint }: { href: string; icon: typeof Package; label: string; value: string; hint: string }) {
  return (
    <Link href={href} className="group flex flex-col gap-1 rounded-3xl border p-5 transition-colors hover:border-foreground/25">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" />
        {label}
        <ArrowRight className="ml-auto size-4 opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="truncate text-xl font-semibold tracking-tight tabular-nums">{value}</span>
      <span className="truncate text-xs text-muted-foreground">{hint}</span>
    </Link>
  );
}

/** The checks of the client's organizations: a rejected one to correct, one being checked (the client buys as a
 * private person meanwhile, or for another organization), or an invitation to add one. */
function OrganizationsNotice({ organizations }: { organizations: Organization[] }) {
  const rejected = organizations.find((o) => o.status === "rejected");
  const pending = organizations.find((o) => o.status === "pending");
  const approved = organizations.some((o) => o.status === "approved");
  if (rejected) {
    return (
      <Banner tone="bad" icon={<CircleAlert className="size-5 text-destructive" />} title={`${rejected.name}: организация не подтверждена`}>
        {rejected.review_note && <p>Причина: {rejected.review_note}</p>}
        <p>Исправьте реквизиты — организация снова уйдёт на проверку.</p>
        <Link href="/account/organizations" className={cn(buttonVariants({ size: "sm" }), "mt-2 rounded-lg")}>
          Исправить реквизиты
        </Link>
      </Banner>
    );
  }
  if (pending) {
    return (
      <Banner tone="wait" icon={<Clock className="size-5 text-amber-700" />} title={`${pending.name} на проверке`}>
        <p>
          Менеджер проверит реквизиты в рабочее время и, возможно, позвонит. После подтверждения цены, корзина и заказы переключатся на
          организацию, по оптовым ценам. {approved ? "" : "Пока вы покупаете как физическое лицо."}
        </p>
        <Link href="/account/organizations" className={cn(buttonVariants({ size: "sm", variant: "outline" }), "mt-2 rounded-lg bg-background")}>
          Реквизиты организации
        </Link>
      </Banner>
    );
  }
  if (organizations.length) return null;
  return (
    <Banner tone="info" icon={<Building2 className="size-5 text-primary" />} title="Работаете от компании или ИП?">
      <p>Добавьте организацию по ИНН — после проверки откроются оптовые цены, договоры и КП для ваших клиентов. Пока цены — для физ. лиц.</p>
      <Link href="/account/organizations?add=1" className={cn(buttonVariants({ size: "sm" }), "mt-2 rounded-lg")}>
        Добавить организацию
      </Link>
    </Banner>
  );
}

const BANNER = { wait: "bg-amber-500/10", bad: "bg-destructive/8", info: "bg-primary/[0.06]" };

function Banner({ tone, icon, title, children }: { tone: keyof typeof BANNER; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className={cn("flex gap-3 rounded-3xl p-5 text-sm", BANNER[tone])}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 space-y-1.5">
        <p className="text-base font-semibold">{title}</p>
        {children}
      </div>
    </div>
  );
}

function SectionHead({ title, href, link }: { title: string; href?: string; link?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {href && (
        <Link href={href} className="text-sm font-medium text-primary hover:underline">
          {link}
        </Link>
      )}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="container-shop space-y-8 pt-6 sm:pt-8" aria-hidden>
      <Skeleton className="h-9 w-72" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-3xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-3xl" />
    </div>
  );
}
