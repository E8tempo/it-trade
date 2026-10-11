import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CategoryIcon } from "@/components/catalog/category-icon";
import { Listing, ListingSkeleton } from "@/components/catalog/listing";
import { Skeleton } from "@/components/ui/skeleton";
import { getCategoryTree } from "@/lib/catalog";
import { countLabel } from "@/lib/format";
import { categoryHref, parseListing } from "@/lib/urls";

type Props = PageProps<"/search">;

function queryText(sp: Awaited<Props["searchParams"]>): string {
  const q = sp.q;
  return (Array.isArray(q) ? q[0] : q)?.trim().slice(0, 200) ?? "";
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = queryText(await searchParams);
  return { title: q ? `«${q}» — поиск` : "Поиск", robots: { index: false } };
}

export default function SearchPage({ searchParams }: Props) {
  return (
    <div className="container-shop pt-5 sm:pt-8">
      <Suspense fallback={<Skeleton className="mb-8 h-8 w-80" />}>
        <SearchHeader searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<ListingSkeleton />}>
        <SearchResults searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SearchHeader({ searchParams }: Pick<Props, "searchParams">) {
  const sp = await searchParams;
  const q = queryText(sp);
  const { vendors } = parseListing(sp);
  const title = q ? `Результаты по запросу «${q}»` : vendors.length === 1 ? vendors[0] : "Поиск по каталогу";
  return <h1 className="mb-8 text-[26px] leading-tight font-semibold tracking-tight sm:text-3xl">{title}</h1>;
}

async function SearchResults({ searchParams }: Pick<Props, "searchParams">) {
  const sp = await searchParams;
  const q = queryText(sp);
  const query = parseListing(sp, { q: q || undefined });
  if (!q && query.vendors.length === 0) return <SearchPrompt />;
  return <Listing query={query} basePath="/search" />;
}

async function SearchPrompt() {
  const roots = await getCategoryTree(1);
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">Введите название товара, бренд или артикул в строке поиска — или выберите раздел:</p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {roots.map((c) => (
          <li key={c.id}>
            <Link href={categoryHref(c)} className="flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-muted">
              <CategoryIcon name={c.name} className="size-5 text-muted-foreground" />
              <span className="flex-1 text-sm font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground">{countLabel(c.product_count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
