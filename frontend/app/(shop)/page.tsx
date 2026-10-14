import { ArrowRight, BadgePercent, FileSignature, LayoutGrid, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { CategoryIcon } from "@/components/catalog/category-icon";
import { ProductGridSkeleton } from "@/components/catalog/listing";
import { ProductGrid } from "@/components/catalog/product-card";
import { ClientHome } from "@/components/home/client-home";
import { PostsList } from "@/components/home/posts-list";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCategoryTree, getPosts, getProducts, getShop } from "@/lib/catalog";
import { countLabel } from "@/lib/format";
import type { SortKey } from "@/lib/types";
import { categoryHref } from "@/lib/urls";
import { cn } from "@/lib/utils";

// A signed-in client sees their home (rendered in the browser); a guest, the landing for businesses. The
// `authed:` variant picks one before the first paint for a visitor who was signed in last time.
export default function HomePage() {
  return (
    <>
      <div className="hidden authed:block">
        <ClientHome />
      </div>
      <div className="authed:hidden">
        <Landing />
      </div>
    </>
  );
}

// Everything below reads backend data at request time (connection()), cached per data function.
function Landing() {
  return (
    <div className="space-y-12 sm:space-y-20">
      <section className="container-shop pt-8 sm:pt-16">
        <Suspense fallback={<HeroSkeleton />}>
          <Hero />
        </Suspense>
      </section>

      <section className="container-shop">
        <Benefits />
      </section>

      <section className="container-shop">
        <SectionTitle title="Каталог" />
        <Suspense fallback={<CategoriesSkeleton />}>
          <RootCategories />
        </Suspense>
      </section>

      <Suspense fallback={null}>
        <LandingPosts />
      </Suspense>

      <section className="container-shop">
        <Steps />
      </section>

      <Showcase title="Новинки" sort="new" />
    </div>
  );
}

async function Hero() {
  await connection();
  const [shop, roots] = await Promise.all([getShop(), getCategoryTree(1)]);
  const total = roots.reduce((n, c) => n + c.product_count, 0);
  return (
    <div className="max-w-3xl">
      <p className="mb-3 inline-flex rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">Для компаний и ИП</p>
      <h1 className="text-[28px] leading-[1.12] font-semibold tracking-tight sm:text-5xl sm:leading-[1.08] lg:text-[56px]">
        {shop.tagline}
      </h1>
      <p className="mt-4 max-w-xl text-base text-muted-foreground sm:mt-5 sm:text-lg">
        Оптовые поставки для бизнеса: {countLabel(total)} в наличии, цены для вашей организации, работа по договору.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Link href="/register" className={cn(buttonVariants({ size: "lg" }), "h-12 rounded-xl px-6 text-[15px]")}>
          Стать клиентом
        </Link>
        <Link href="/login" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 rounded-xl px-6 text-[15px]")}>
          Войти в кабинет
        </Link>
      </div>
    </div>
  );
}

const BENEFITS = [
  { icon: BadgePercent, title: "Оптовые цены", text: "Свои цены для вашей организации — за наличные и по безналу." },
  { icon: FileSignature, title: "Работа по договору", text: "Предоплата или отсрочка платежа, документы на организацию." },
  { icon: Wallet, title: "Кабинет клиента", text: "Корзина, заказы и их статусы, несколько сотрудников в одной компании." },
  { icon: Truck, title: "Доставка по Крыму", text: "Курьером по городу, транспортной компанией или самовывоз." },
];

function Benefits() {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {BENEFITS.map(({ icon: Icon, title, text }) => (
        <li key={title} className="rounded-3xl bg-muted/50 p-5">
          <span className="grid size-10 place-items-center rounded-xl bg-background shadow-xs">
            <Icon className="size-5 text-primary" />
          </span>
          <p className="mt-4 font-semibold">{title}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p>
        </li>
      ))}
    </ul>
  );
}

const STEPS = [
  { title: "Зарегистрируйте организацию", text: "ИНН и название — КПП и остальное по желанию." },
  { title: "Менеджер проверит её", text: "В рабочее время, иногда с коротким звонком." },
  { title: "Заказывайте по своим ценам", text: "Оптовые цены, договор, история заказов в кабинете." },
];

function Steps() {
  return (
    <div className="rounded-3xl border p-6 sm:p-10">
      <h2 className="text-2xl font-semibold tracking-tight">Как начать работать</h2>
      <ol className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-sm font-semibold text-background tabular-nums">
              {i + 1}
            </span>
            <span>
              <span className="block font-semibold">{s.title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <Link href="/register" className={cn(buttonVariants({ size: "lg" }), "mt-8 h-11 rounded-xl px-5")}>
        Зарегистрировать организацию
      </Link>
    </div>
  );
}

async function LandingPosts() {
  await connection();
  const posts = await getPosts(3);
  if (!posts.length) return null;
  return (
    <section className="container-shop">
      <SectionTitle title="Новости и акции" />
      <PostsList posts={posts} />
    </section>
  );
}

const MOBILE_TILES = 7;
const tile = "group flex h-full items-center gap-2.5 rounded-2xl bg-muted/60 p-2 pr-2.5 transition-colors hover:bg-muted sm:gap-3 sm:p-3";
const tileIcon =
  "grid size-9 shrink-0 place-items-center rounded-xl bg-background shadow-xs transition-transform duration-300 group-hover:scale-105 sm:size-11";

async function RootCategories() {
  await connection();
  const roots = [...(await getCategoryTree(1))].sort((a, b) => b.product_count - a.product_count);
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-6">
      {roots.map((c, i) => (
        <li key={c.id} className={i >= MOBILE_TILES ? "max-sm:hidden" : undefined}>
          <Link href={categoryHref(c)} className={tile}>
            <span className={tileIcon}>
              <CategoryIcon name={c.name} className="size-5 text-foreground/80" />
            </span>
            <span className="min-w-0">
              <span className="line-clamp-2 text-[13px] leading-snug font-medium hyphens-auto sm:text-sm">{c.name}</span>
              <span className="block text-xs text-muted-foreground">{countLabel(c.product_count)}</span>
            </span>
          </Link>
        </li>
      ))}
      <li>
        <Link href="/catalog" className={tile}>
          <span className={tileIcon}>
            <LayoutGrid className="size-5 text-primary" />
          </span>
          <span className="text-[13px] leading-snug font-medium text-primary sm:text-sm">Весь каталог</span>
        </Link>
      </li>
    </ul>
  );
}

function Showcase({ title, sort }: { title: string; sort: SortKey }) {
  return (
    <section className="container-shop">
      <SectionTitle title={title} />
      <Suspense fallback={<ProductGridSkeleton count={10} layout="wide" />}>
        <ShowcaseProducts sort={sort} />
      </Suspense>
    </section>
  );
}

async function ShowcaseProducts({ sort }: { sort: SortKey }) {
  await connection();
  const page = await getProducts({ vendors: [], sort, page: 1 }, { perPage: 10, withImage: true, facets: false });
  return <ProductGrid products={page.items} />;
}

function SectionTitle({ title, href, linkText }: { title: string; href?: string; linkText?: string }) {
  return (
    <div className="mb-6 flex items-baseline justify-between gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      {href && (
        <Link href={href} className="group inline-flex items-center gap-1 text-sm font-medium text-primary">
          {linkText}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div className="max-w-3xl space-y-4" aria-hidden>
      <Skeleton className="h-12 w-full sm:h-14" />
      <Skeleton className="h-12 w-2/3 sm:h-14" />
      <Skeleton className="mt-6 h-6 w-full max-w-xl" />
    </div>
  );
}

function CategoriesSkeleton() {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-6" aria-hidden>
      {Array.from({ length: 18 }, (_, i) => (
        <li key={i} className={i >= 8 ? "max-sm:hidden" : undefined}>
          <Skeleton className="h-[60px] rounded-2xl sm:h-[68px]" />
        </li>
      ))}
    </ul>
  );
}
