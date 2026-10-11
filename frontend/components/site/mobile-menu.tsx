"use client";

import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CategoryIcon } from "@/components/catalog/category-icon";
import { MenuError } from "@/components/site/catalog-menu";
import { useCategoryTree } from "@/components/site/use-category-tree";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { countLabel } from "@/lib/format";
import type { CategoryNode } from "@/lib/types";
import { categoryHref } from "@/lib/urls";

/** Mobile catalog: a drill-down list in a side sheet. */
export function MobileMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<CategoryNode[]>([]);
  const { tree, error, retry } = useCategoryTree(open);

  const current = path.at(-1);
  const items = current ? current.children : (tree ?? []);
  const close = () => setOpen(false);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setPath([]);
      }}
    >
      <SheetTrigger render={<Button variant="ghost" size="icon-lg" aria-label="Каталог" className={className} />}>
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-[88vw] gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="h-14 flex-row items-center border-b px-2">
          {current ? (
            <button
              type="button"
              onClick={() => setPath((p) => p.slice(0, -1))}
              className="flex min-w-0 items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-muted"
            >
              <ChevronLeft className="size-4 shrink-0" />
              <span className="truncate">{path.at(-2)?.name ?? "Каталог"}</span>
            </button>
          ) : (
            <SheetTitle className="px-2 text-base font-semibold">Каталог</SheetTitle>
          )}
        </SheetHeader>

        <nav className="flex-1 overflow-y-auto py-2" aria-label="Каталог">
          {current && (
            <Link
              href={categoryHref(current)}
              onClick={close}
              className="mx-2 mb-1 flex items-center justify-between rounded-lg px-3 py-3 hover:bg-muted"
            >
              <span className="font-semibold">{current.name}</span>
              <span className="text-xs text-muted-foreground">{countLabel(current.product_count)}</span>
            </Link>
          )}
          {tree ? (
            <ul>
              {items.map((c) => (
                <li key={c.id}>
                  {c.children.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setPath((p) => [...p, c])}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left text-[15px] hover:bg-muted"
                    >
                      {!current && <CategoryIcon name={c.name} className="size-5 shrink-0 text-muted-foreground" />}
                      <span className="flex-1">{c.name}</span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  ) : (
                    <Link href={categoryHref(c)} onClick={close} className="flex items-center gap-3 px-5 py-3 text-[15px] hover:bg-muted">
                      {!current && <CategoryIcon name={c.name} className="size-5 shrink-0 text-muted-foreground" />}
                      <span className="flex-1">{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.product_count}</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : error ? (
            <MenuError onRetry={retry} />
          ) : (
            <div className="space-y-3 px-5 py-2">
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
