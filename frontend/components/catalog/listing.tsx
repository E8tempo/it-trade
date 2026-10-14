import { Filters } from "@/components/catalog/filters";
import { ListingProvider, ListingResults } from "@/components/catalog/listing-context";
import { EmptyResults, ListingToolbar, Pagination } from "@/components/catalog/listing-toolbar";
import { ProductGrid } from "@/components/catalog/product-card";
import { Skeleton } from "@/components/ui/skeleton";
import { getProducts } from "@/lib/catalog";
import type { ListingQuery } from "@/lib/types";
import { PER_PAGE } from "@/lib/urls";

/** Products of a category or a search with filters, sorting and pagination. */
export async function Listing({ query, basePath }: { query: ListingQuery; basePath: string }) {
  const page = await getProducts(query, { perPage: PER_PAGE });
  const totalPages = Math.min(Math.ceil(page.total / page.per_page), 1000);
  const facets = { vendors: page.vendors };

  return (
    <ListingProvider basePath={basePath} query={query}>
      <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-[16.5rem_minmax(0,1fr)]">
        <aside className="hidden lg:block" aria-label="Фильтры">
          <Filters {...facets} />
        </aside>
        <div className="min-w-0">
          <ListingToolbar total={page.total} {...facets} />
          <ListingResults>
            {page.items.length > 0 ? (
              <ProductGrid products={page.items} layout="narrow" priorityCount={4} />
            ) : (
              <EmptyResults />
            )}
          </ListingResults>
          <Pagination totalPages={totalPages} />
        </div>
      </div>
    </ListingProvider>
  );
}

export function ProductGridSkeleton({ count = 8, layout = "narrow" }: { count?: number; layout?: "narrow" | "wide" }) {
  return (
    <ul
      className={
        layout === "narrow"
          ? "grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-5 xl:grid-cols-4"
          : "grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 xl:grid-cols-5"
      }
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="space-y-3">
          <Skeleton className="aspect-square rounded-2xl" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </li>
      ))}
    </ul>
  );
}

export function ListingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      <div className="hidden space-y-8 lg:block" aria-hidden>
        <div className="space-y-3">
          <Skeleton className="h-4 w-16" />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-14" />
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-9 w-44" />
        </div>
        <ProductGridSkeleton count={12} />
      </div>
    </div>
  );
}
