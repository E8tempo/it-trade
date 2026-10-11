"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Updates `?q=` on submit and drops the page number. */
export function SearchInput({ placeholder, className }: { placeholder: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (value.trim()) next.set("q", value.trim());
    else next.delete("q");
    next.delete("page");
    router.push(`${pathname}?${next}`);
  }

  return (
    <form onSubmit={onSubmit} className={cn("relative w-full sm:w-80", className)} role="search">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-9 bg-background pl-9"
      />
    </form>
  );
}

/** Previous / next links that keep the other query parameters. */
export function Pager({ page, perPage, total }: { page: number; perPage: number; total: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const next = new URLSearchParams(params);
    if (p > 1) next.set("page", String(p));
    else next.delete("page");
    return `${pathname}?${next}`;
  };
  const link = "rounded-lg px-3 py-1.5 ring-1 ring-foreground/10 hover:bg-muted";
  return (
    <nav className="mt-4 flex items-center justify-end gap-2 text-sm" aria-label="Страницы">
      {page > 1 && (
        <Link href={href(page - 1)} className={link}>
          Назад
        </Link>
      )}
      <span className="px-2 text-muted-foreground tabular-nums">
        {page} из {pages}
      </span>
      {page < pages && (
        <Link href={href(page + 1)} className={link}>
          Дальше
        </Link>
      )}
    </nav>
  );
}
