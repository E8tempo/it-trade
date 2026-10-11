"use client";

import { ChevronRight, LayoutGrid, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { CategoryIcon } from "@/components/catalog/category-icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { loadCategoryTree, useCategoryTree } from "@/components/site/use-category-tree";
import { countLabel } from "@/lib/format";
import type { CategoryNode } from "@/lib/types";
import { categoryHref } from "@/lib/urls";
import { cn } from "@/lib/utils";

const SUBLINKS = 5;

/** Desktop catalog: a full-width panel under the header with roots on the left. */
export function CatalogMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const { tree, error, retry } = useCategoryTree(open);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const active = tree?.find((c) => c.id === activeId) ?? tree?.[0];

  return (
    <div className={className}>
      <Button
        size="lg"
        variant={open ? "secondary" : "default"}
        className="h-11 gap-2 rounded-xl px-4 text-[15px]"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        onPointerEnter={() => void loadCategoryTree().catch(() => {})}
      >
        {open ? <X className="size-[18px]" /> : <LayoutGrid className="size-[18px]" />}
        Каталог
      </Button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-30 bg-black/25 animate-in fade-in-0" onClick={close} aria-hidden />,
          document.body,
        )}

      {open && (
        <div className="absolute inset-x-0 top-full border-b bg-background shadow-2xl shadow-black/10 animate-in fade-in-0 slide-in-from-top-2">
          <div className="container-shop grid h-[min(72vh,620px)] grid-cols-[17rem_minmax(0,1fr)] gap-8 py-6">
            <nav aria-label="Разделы каталога" className="-ml-2 overflow-y-auto border-r pr-4">
              {tree ? (
                <ul className="space-y-0.5">
                  {tree.map((root) => (
                    <li key={root.id}>
                      <Link
                        href={categoryHref(root)}
                        onClick={close}
                        onPointerEnter={() => setActiveId(root.id)}
                        onFocus={() => setActiveId(root.id)}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
                          root.id === active?.id ? "bg-muted font-medium text-foreground" : "text-foreground/80 hover:bg-muted/60",
                        )}
                      >
                        <CategoryIcon name={root.name} className="size-[18px] shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{root.name}</span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : error ? (
                <MenuError onRetry={retry} />
              ) : (
                <div className="space-y-2 px-2.5">
                  {Array.from({ length: 12 }, (_, i) => (
                    <Skeleton key={i} className="h-7 w-full" />
                  ))}
                </div>
              )}
            </nav>
            <div className="overflow-y-auto pr-2">{active && <RootPanel root={active} onNavigate={close} />}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function RootPanel({ root, onNavigate }: { root: CategoryNode; onNavigate: () => void }) {
  return (
    <div key={root.id} className="animate-in fade-in-0">
      <div className="mb-5 flex items-baseline gap-3">
        <Link href={categoryHref(root)} onClick={onNavigate} className="text-xl font-semibold tracking-tight hover:text-primary">
          {root.name}
        </Link>
        <span className="text-sm text-muted-foreground">{countLabel(root.product_count)}</span>
      </div>
      <div className="columns-2 gap-x-10 xl:columns-3">
        {root.children.map((child) => (
          <section key={child.id} className="mb-6 break-inside-avoid">
            <Link href={categoryHref(child)} onClick={onNavigate} className="text-sm font-semibold hover:text-primary">
              {child.name}
            </Link>
            {child.children.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {child.children.slice(0, SUBLINKS).map((g) => (
                  <li key={g.id}>
                    <Link
                      href={categoryHref(g)}
                      onClick={onNavigate}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {g.name}
                    </Link>
                  </li>
                ))}
                {child.children.length > SUBLINKS && (
                  <li>
                    <Link href={categoryHref(child)} onClick={onNavigate} className="text-sm text-primary hover:underline">
                      Ещё {child.children.length - SUBLINKS}
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

export function MenuError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-3 px-2.5 py-2 text-sm text-muted-foreground">
      <p>Не удалось загрузить каталог.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Повторить
      </Button>
    </div>
  );
}
