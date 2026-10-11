"use client";

import { useRouter } from "next/navigation";
import { createContext, use, useOptimistic, useTransition, type ReactNode } from "react";

import type { ListingQuery } from "@/lib/types";
import { listingSearch } from "@/lib/urls";
import { cn } from "@/lib/utils";

type Listing = {
  /** Current query; already reflects a filter change while its page is loading. */
  query: ListingQuery;
  pending: boolean;
  href: (patch: Partial<ListingQuery>) => string;
  navigate: (patch: Partial<ListingQuery>, options?: { scroll?: boolean }) => void;
};

const ListingContext = createContext<Listing | null>(null);

/** Filters, sorting and pagination of a listing page live in the URL; this pushes URL changes. */
export function ListingProvider({ basePath, query, children }: { basePath: string; query: ListingQuery; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(query);

  // any filter change starts from page 1 unless the patch sets the page itself
  const href = (patch: Partial<ListingQuery>) => basePath + listingSearch(query, { page: 1, ...patch });

  const navigate: Listing["navigate"] = (patch, options) => {
    startTransition(() => {
      setOptimistic({ ...query, page: 1, ...patch });
      router.push(href(patch), { scroll: options?.scroll ?? false });
    });
  };

  return <ListingContext value={{ query: optimistic, pending, href, navigate }}>{children}</ListingContext>;
}

export function useListing(): Listing {
  const ctx = use(ListingContext);
  if (!ctx) throw new Error("useListing must be used inside <ListingProvider>");
  return ctx;
}

/** Dims the results while the next page of the listing is loading. */
export function ListingResults({ children }: { children: ReactNode }) {
  const { pending } = useListing();
  return (
    <div aria-busy={pending} className={cn("transition-opacity duration-200", pending && "pointer-events-none opacity-50")}>
      {children}
    </div>
  );
}
