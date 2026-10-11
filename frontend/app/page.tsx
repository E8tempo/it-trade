import { ArrowRight, LayoutGrid } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { CategoryIcon } from "@/components/catalog/category-icon";
import { ProductGridSkeleton } from "@/components/catalog/listing";
import { ProductGrid } from "@/components/catalog/product-card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCategoryTree, getProducts, getShop } from "@/lib/catalog";
import { countLabel } from "@/lib/format";
import type { SortKey } from "@/lib/types";
import { categoryHref } from "@/lib/urls";

// Everything below reads backend data at request time (connection()), cached per data function.
export default function HomePage() {
  return (
    <div className="space-y-12 sm:space-y-20">
      <section className="container-shop pt-8 sm:pt-16">
        <Suspense fallback={<HeroSkeleton />}>
          <Hero />
        </Suspense>
      </section>

      <section className="container-shop">
        <SectionTitle title="Каталог" />
        <Suspense fallback={<CategoriesSkeleton />}>
          <RootCategories />
        </Suspense>
      </section>

      <Showcase title="Новинки" sort="new" />
      <Showcase title="Популярные товары" sort="popular" />
    </div>
  );
}

async function Hero() {
  await connection();
  const [shop, roots] = await Promise.all([getShop(), getCategoryTree(1)]);
  const total = roots.reduce((n, c) => n + c.product_count, 0);
  return (
    <div className="max-w-3xl">
      <h1 className="text-[28px] leading-[1.12] font-semibold tracking-tight sm:text-5xl sm:leading-[1.08] lg:text-[56px]">
        {shop.tagline}
      </h1>
      <p className="mt-4 max-w-xl text-base text-muted-foreground sm:mt-5 sm:text-lg">
        {countLabel(total)} в наличии — от комплектующих и бытовой техники до инструментов и товаров для дома.
      </p>
    </div>
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
