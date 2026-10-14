"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState, type KeyboardEvent } from "react";

import { CardPrice } from "@/components/catalog/card-price";
import { ProductImage } from "@/components/catalog/product-image";
import { countLabel } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import type { ProductCard, ProductPage } from "@/lib/types";
import { productHref } from "@/lib/urls";
import { cn } from "@/lib/utils";

const MIN_CHARS = 2;

/** Header search with live suggestions. Shows the current query on the /search page. */
export function SearchBox({ className }: { className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const q = pathname === "/search" ? (searchParams.get("q") ?? "") : "";
  // a new query in the URL resets the input
  return <SearchBoxInner key={q} initial={q} className={className} />;
}

export function SearchBoxFallback({ className }: { className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" />
      <div className="h-11 w-full rounded-xl border border-transparent bg-muted/70" />
    </div>
  );
}

type Suggestions = { q: string; items: ProductCard[]; total: number };

function SearchBoxInner({ initial, className }: { initial: string; className?: string }) {
  const router = useRouter();
  const listId = useId();
  const [value, setValue] = useState(initial);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [data, setData] = useState<Suggestions | null>(null);
  const query = useDebounced(value.trim(), 250);

  useEffect(() => {
    if (query.length < MIN_CHARS) return;
    const ctrl = new AbortController();
    const sp = new URLSearchParams({ q: query, per_page: "6", facets: "false" });
    fetch(`/api/products?${sp}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<ProductPage>) : Promise.reject(new Error(String(r.status)))))
      .then((page) => setData({ q: query, items: page.items, total: page.total }))
      .catch(() => {});
    return () => ctrl.abort();
  }, [query]);

  const active = value.trim().length >= MIN_CHARS;
  const fresh = data !== null && data.q === query && query === value.trim();
  const items = active && data ? data.items : []; // previous results stay visible while typing
  const loading = active && !fresh;
  const open = focused && active && (items.length > 0 || fresh);

  function go(href: string) {
    setFocused(false);
    router.push(href);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setFocused(false);
      e.currentTarget.blur();
      return;
    }
    if (!open || items.length === 0) return;
    const count = items.length + 1; // + "all results"
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % count);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? count - 1 : h - 1));
    } else if (e.key === "Enter" && highlight >= 0 && highlight < items.length) {
      e.preventDefault();
      go(productHref(items[highlight]));
    }
  }

  return (
    <form
      role="search"
      action="/search"
      className={cn("relative", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const t = value.trim();
        if (t) go(`/search?q=${encodeURIComponent(t)}`);
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" />
      <input
        name="q"
        type="search"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setHighlight(-1);
          setFocused(true);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        placeholder="Поиск: название, бренд или артикул"
        autoComplete="off"
        enterKeyHint="search"
        role="combobox"
        aria-label="Поиск по каталогу"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && highlight >= 0 ? `${listId}-${highlight}` : undefined}
        className={cn(
          "h-11 w-full appearance-none rounded-xl border border-transparent bg-muted/70 pl-10 text-[15px] text-ellipsis transition-colors outline-none placeholder:text-muted-foreground/80 hover:bg-muted focus:border-ring focus:bg-background focus:ring-3 focus:ring-ring/25 [&::-webkit-search-cancel-button]:hidden",
          // room for the clear button / spinner only when they can show, so the hint fits on phones
          value ? "pr-11" : "pr-3",
        )}
      />
      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center">
        {loading && focused ? (
          <LoaderCircle className="m-1.5 size-4 animate-spin text-muted-foreground" aria-label="Поиск…" />
        ) : value ? (
          <button
            type="button"
            aria-label="Очистить"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setValue("");
              setHighlight(-1);
            }}
            className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {open && (
        <div
          id={listId}
          role="listbox"
          onMouseDown={(e) => e.preventDefault()} // keep focus in the input while clicking
          className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-xl shadow-black/5 animate-in fade-in-0 slide-in-from-top-1"
        >
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Ничего не нашлось. Попробуйте другой запрос.</p>
          ) : (
            <>
              <ul className="py-1.5">
                {items.map((p, i) => (
                  <li key={p.sku}>
                    <Link
                      id={`${listId}-${i}`}
                      href={productHref(p)}
                      role="option"
                      aria-selected={i === highlight}
                      onClick={() => setFocused(false)}
                      onMouseEnter={() => setHighlight(i)}
                      className={cn("flex items-center gap-3 px-3 py-2 transition-colors", i === highlight && "bg-muted")}
                    >
                      <span className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted/70 p-1">
                        <ProductImage image={p.image} alt="" sizes="48px" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm leading-snug">{p.name}</span>
                        {p.part && <span className="font-mono text-xs text-muted-foreground">{p.part}</span>}
                      </span>
                      <CardPrice sku={p.sku} quiet className="shrink-0 text-sm font-semibold tabular-nums" />
                    </Link>
                  </li>
                ))}
              </ul>
              <button
                type="submit"
                onMouseEnter={() => setHighlight(items.length)}
                className={cn(
                  "flex w-full items-center justify-between border-t px-4 py-3 text-sm font-medium transition-colors",
                  highlight === items.length ? "bg-muted" : "hover:bg-muted",
                )}
              >
                Все результаты
                {data && <span className="text-muted-foreground">{countLabel(data.total)}</span>}
              </button>
            </>
          )}
        </div>
      )}
    </form>
  );
}
