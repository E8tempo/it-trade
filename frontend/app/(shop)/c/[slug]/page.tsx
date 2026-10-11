import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { Listing, ListingSkeleton } from "@/components/catalog/listing";
import { Skeleton } from "@/components/ui/skeleton";
import { getCategory } from "@/lib/catalog";
import { countLabel } from "@/lib/format";
import type { CategoryDetail, CategoryNode } from "@/lib/types";
import { categoryHref, idFromSlug, parseListing } from "@/lib/urls";

type Props = PageProps<"/c/[slug]">;

async function loadCategory(params: Props["params"]): Promise<CategoryDetail> {
  const id = idFromSlug((await params).slug);
  const category = id ? await getCategory(id) : null;
  if (!category) notFound();
  return category;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = idFromSlug((await params).slug);
  const category = id ? await getCategory(id) : null;
  if (!category) return { title: "Категория не найдена" };
  return {
    title: category.name,
    description: `${category.name}: ${countLabel(category.product_count)} в наличии. Цены, фото и характеристики.`,
    alternates: { canonical: categoryHref(category) },
  };
}

export default function CategoryPage({ params, searchParams }: Props) {
  return (
    <div className="container-shop pt-5 sm:pt-8">
      <Suspense fallback={<CategoryHeaderSkeleton />}>
        <CategoryHeader params={params} />
      </Suspense>
      <Suspense fallback={<ListingSkeleton />}>
        <CategoryListing params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function CategoryHeader({ params }: Pick<Props, "params">) {
  const category = await loadCategory(params);
  const crumbs = [
    { name: "Главная", href: "/" },
    ...category.breadcrumbs.slice(0, -1).map((c) => ({ name: c.name, href: categoryHref(c) })),
    { name: category.name },
  ];
  return (
    <header className="mb-8 space-y-4 sm:space-y-5">
      <Breadcrumbs items={crumbs} />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight sm:text-3xl">{category.name}</h1>
        <span className="text-sm text-muted-foreground">{countLabel(category.product_count)}</span>
      </div>
      {category.children.length > 0 && <SubcategoryChips categories={category.children} />}
    </header>
  );
}

function SubcategoryChips({ categories }: { categories: CategoryNode[] }) {
  return (
    <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
      {categories.map((c) => (
        <li key={c.id} className="shrink-0">
          <Link
            href={categoryHref(c)}
            className="flex h-9 items-center gap-2 rounded-full border bg-background px-4 text-sm transition-colors hover:border-foreground/25 hover:bg-muted"
          >
            {c.name}
            <span className="text-xs text-muted-foreground tabular-nums">{c.product_count}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function CategoryListing({ params, searchParams }: Props) {
  const category = await loadCategory(params);
  const query = parseListing(await searchParams, { category: category.id });
  return <Listing query={query} basePath={categoryHref(category)} />;
}

function CategoryHeaderSkeleton() {
  return (
    <div className="mb-8 space-y-5" aria-hidden>
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-8 w-72" />
      <div className="flex gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-32 rounded-full" />
        ))}
      </div>
    </div>
  );
}
