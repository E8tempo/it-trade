import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Pager, SearchInput } from "@/components/admin/list-controls";
import { ProductsTable } from "@/components/admin/products-table";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_SUPPLIER } from "@/lib/admin/suppliers";
import type { AdminProduct, Page } from "@/lib/admin/types";
import { apiServer } from "@/lib/api/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Товары и цены" };

type Props = PageProps<"/admin/products">;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const VIEWS = {
  all: { label: "Все", params: {} },
  in_stock: { label: "В наличии", params: { in_stock: "true" } },
  fixed: { label: "Фиксированная цена", params: { override: "true" } },
  hidden: { label: "Скрытые", params: { hidden: "true" } },
} as const;

const SORTS = { new: "Сначала новые", price: "Дороже", markup: "Больше наценка", name: "По названию" } as const;

export default function ProductsPage({ searchParams }: Props) {
  return (
    <>
      <PageHeader
        title="Товары и цены"
        description={
          <>
            У товара четыре цены: опт для организаций и цены для физ. лиц, каждая за наличные и по безналу. Каждая считается от закупочной
            цены по{" "}
            <Link href={`/admin/suppliers/${DEFAULT_SUPPLIER}`} className="text-primary hover:underline">
              правилам поставщика
            </Link>
            . Любую из них можно зафиксировать для отдельного товара вручную, а товар — скрыть с сайта.
          </>
        }
      />
      <Suspense fallback={<Skeleton className="h-[32rem] rounded-2xl" />}>
        <ProductsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ProductsContent({ searchParams }: Pick<Props, "searchParams">) {
  const sp = await searchParams;
  const view = (one(sp.view) ?? "all") as keyof typeof VIEWS;
  const sort = (one(sp.sort) ?? "new") as keyof typeof SORTS;
  const q = one(sp.q);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const query = new URLSearchParams({ ...(VIEWS[view]?.params ?? {}), sort, page: String(page), per_page: "50" });
  if (q) query.set("q", q);
  const data = await apiServer<Page<AdminProduct>>(`/api/admin/products?${query}`);

  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { view, sort, q, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "view" && v === "all") && !(k === "sort" && v === "new")) next.set(k, v);
    return `/admin/products${next.size ? `?${next}` : ""}`;
  };
  const pill = (active: boolean) =>
    cn(
      "rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  return (
    <Panel>
      <div className="mb-4 flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="no-scrollbar -mx-1 flex shrink-0 gap-1 overflow-x-auto px-1">
          {Object.entries(VIEWS).map(([k, v]) => (
            <Link key={k} href={link({ view: k })} className={pill(view === k)}>
              {v.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="no-scrollbar flex items-center gap-1 overflow-x-auto text-sm">
            <span className="pr-1 text-muted-foreground">Сортировка:</span>
            {Object.entries(SORTS).map(([k, label]) => (
              <Link
                key={k}
                href={link({ sort: k })}
                className={cn(
                  "rounded-md px-2 py-1 whitespace-nowrap transition-colors",
                  sort === k ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            ))}
          </div>
          <SearchInput placeholder="Название, артикул, бренд" />
        </div>
      </div>
      <p className="mb-2 text-sm text-muted-foreground">Найдено: {data.total.toLocaleString("ru-RU")}</p>
      <div className="overflow-x-auto">
        <ProductsTable products={data.items} />
      </div>
      <Pager page={data.page} perPage={data.per_page} total={data.total} />
    </Panel>
  );
}
