import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { CategoryIcon } from "@/components/catalog/category-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { getCategoryTree } from "@/lib/catalog";
import { countLabel } from "@/lib/format";
import { categoryHref } from "@/lib/urls";

export const metadata: Metadata = { title: "Каталог товаров" };

export default function CatalogPage() {
  return (
    <div className="container-shop pt-5 sm:pt-8">
      <Breadcrumbs items={[{ name: "Главная", href: "/" }, { name: "Каталог" }]} />
      <h1 className="mt-4 mb-10 text-[26px] leading-tight font-semibold tracking-tight sm:text-3xl">Каталог товаров</h1>
      <Suspense fallback={<CatalogSkeleton />}>
        <CategoryColumns />
      </Suspense>
    </div>
  );
}

async function CategoryColumns() {
  await connection();
  const tree = await getCategoryTree(2);
  return (
    <div className="columns-1 gap-x-12 sm:columns-2 lg:columns-3">
      {tree.map((root) => (
        <section key={root.id} className="mb-10 break-inside-avoid">
          <Link href={categoryHref(root)} className="group mb-3 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
              <CategoryIcon name={root.name} className="size-5 text-foreground/80" />
            </span>
            <span>
              <span className="block font-semibold group-hover:text-primary">{root.name}</span>
              <span className="block text-xs text-muted-foreground">{countLabel(root.product_count)}</span>
            </span>
          </Link>
          <ul className="space-y-1.5 pl-[3.25rem]">
            {root.children.map((c) => (
              <li key={c.id}>
                <Link href={categoryHref(c)} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CatalogSkeleton() {
  return (
    <div className="columns-1 gap-x-12 sm:columns-2 lg:columns-3" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="mb-10 space-y-3 break-inside-avoid">
          <Skeleton className="h-10 w-56" />
          {Array.from({ length: 5 }, (_, j) => (
            <Skeleton key={j} className="ml-[3.25rem] h-4 w-40" />
          ))}
        </div>
      ))}
    </div>
  );
}
