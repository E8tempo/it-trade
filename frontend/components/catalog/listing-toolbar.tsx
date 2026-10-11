"use client";

import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { useState, type MouseEvent } from "react";

import { Filters, type FacetsProps } from "@/components/catalog/filters";
import { useListing } from "@/components/catalog/listing-context";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { countLabel, formatNumber } from "@/lib/format";
import type { SortKey } from "@/lib/types";
import { SORTS } from "@/lib/urls";
import { cn } from "@/lib/utils";

export function ListingToolbar({ total, ...facets }: FacetsProps & { total: number }) {
  const { query, navigate } = useListing();
  const filterCount = query.vendors.length + (query.min !== undefined || query.max !== undefined ? 1 : 0);

  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-center gap-2">
        <MobileFilters total={total} filterCount={filterCount} {...facets} />
        <p className="hidden text-sm text-muted-foreground sm:block">{countLabel(total)}</p>
        <Select
          items={SORTS}
          value={query.sort}
          onValueChange={(v) => v && navigate({ sort: v as SortKey })}
        >
          <SelectTrigger className="ml-auto h-9 rounded-lg" aria-label="Сортировка">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {Object.entries(SORTS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ActiveFilters />
    </div>
  );
}

function ActiveFilters() {
  const { query, navigate } = useListing();
  const chips: { label: string; remove: () => void }[] = query.vendors.map((v) => ({
    label: v,
    remove: () => navigate({ vendors: query.vendors.filter((x) => x !== v) }),
  }));
  if (query.min !== undefined || query.max !== undefined) {
    const label = [query.min && `от ${formatNumber(query.min)}`, query.max && `до ${formatNumber(query.max)}`].filter(Boolean).join(" ");
    chips.unshift({ label: `${label} ₽`, remove: () => navigate({ min: undefined, max: undefined }) });
  }
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={c.remove}
          className="flex h-8 items-center gap-1.5 rounded-full bg-secondary pr-2.5 pl-3 text-sm transition-colors hover:bg-muted-foreground/15"
        >
          {c.label}
          <X className="size-3.5 text-muted-foreground" aria-label="Убрать" />
        </button>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={() => navigate({ vendors: [], min: undefined, max: undefined })}
          className="h-8 px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Сбросить всё
        </button>
      )}
    </div>
  );
}

function MobileFilters({ total, filterCount, ...facets }: FacetsProps & { total: number; filterCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" className="h-9 gap-2 rounded-lg lg:hidden" />}>
        <SlidersHorizontal className="size-4" />
        Фильтры
        {filterCount > 0 && (
          <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
            {filterCount}
          </span>
        )}
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85vh] gap-0 rounded-t-3xl p-0">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-base font-semibold">Фильтры</SheetTitle>
        </SheetHeader>
        <div className="overflow-y-auto px-5 py-5">
          <Filters {...facets} />
        </div>
        <div className="border-t p-4">
          <Button className="h-11 w-full rounded-xl text-[15px]" onClick={() => setOpen(false)}>
            Показать {countLabel(total)}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** 1 … 4 5 [6] 7 8 … 20 */
function pageWindow(page: number, last: number): (number | "…")[] {
  const pages = new Set([1, last, page - 1, page, page + 1].filter((p) => p >= 1 && p <= last));
  if (page <= 3) [2, 3, 4].forEach((p) => p <= last && pages.add(p));
  if (page >= last - 2) [last - 3, last - 2, last - 1].forEach((p) => p >= 1 && pages.add(p));
  const sorted = [...pages].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1] > 1 ? (["…", p] as const) : [p]));
}

export function Pagination({ totalPages }: { totalPages: number }) {
  const { query, href, navigate } = useListing();
  if (totalPages <= 1) return null;
  const page = Math.min(query.page, totalPages);
  const go = (p: number) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return; // open in a new tab as usual
    e.preventDefault();
    navigate({ page: p }, { scroll: true });
  };
  const cell = "grid h-10 min-w-10 place-items-center rounded-xl px-3 text-sm tabular-nums transition-colors";

  return (
    <nav aria-label="Страницы" className="mt-12 flex items-center justify-center gap-1">
      {page > 1 ? (
        <a href={href({ page: page - 1 })} onClick={go(page - 1)} className={cn(cell, "hover:bg-muted")} aria-label="Предыдущая страница">
          <ChevronLeft className="size-4" />
        </a>
      ) : (
        <span className={cn(cell, "text-muted-foreground/40")} aria-hidden>
          <ChevronLeft className="size-4" />
        </span>
      )}
      <span className="px-3 text-sm text-muted-foreground tabular-nums sm:hidden">
        {page} из {totalPages}
      </span>
      {pageWindow(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-muted-foreground max-sm:hidden">
            …
          </span>
        ) : (
          <a
            key={p}
            href={href({ page: p })}
            onClick={go(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(cell, "max-sm:hidden", p === page ? "bg-foreground font-semibold text-background" : "hover:bg-muted")}
          >
            {p}
          </a>
        ),
      )}
      {page < totalPages ? (
        <a href={href({ page: page + 1 })} onClick={go(page + 1)} className={cn(cell, "hover:bg-muted")} aria-label="Следующая страница">
          <ChevronRight className="size-4" />
        </a>
      ) : (
        <span className={cn(cell, "text-muted-foreground/40")} aria-hidden>
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}

export function EmptyResults() {
  const { query, navigate } = useListing();
  const filtered = query.vendors.length > 0 || query.min !== undefined || query.max !== undefined;
  return (
    <div className="flex flex-col items-center rounded-3xl bg-muted/50 px-6 py-16 text-center">
      <p className="text-lg font-semibold">Ничего не нашлось</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {filtered ? "Попробуйте изменить или сбросить фильтры." : "Попробуйте изменить запрос или загляните в каталог."}
      </p>
      {filtered && (
        <Button variant="outline" className="mt-5" onClick={() => navigate({ vendors: [], min: undefined, max: undefined })}>
          Сбросить фильтры
        </Button>
      )}
    </div>
  );
}
