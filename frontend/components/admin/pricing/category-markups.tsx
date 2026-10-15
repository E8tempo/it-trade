"use client";

import { ChevronRight, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminCategory } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

type Node = AdminCategory & { children: Node[] };

function buildTree(categories: AdminCategory[]): Node[] {
  const byId = new Map<number, Node>(categories.map((c) => [c.id, { ...c, children: [] }]));
  const roots: Node[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id != null ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function categoryPath(c: AdminCategory, byId: Map<number, AdminCategory>): AdminCategory[] {
  const out: AdminCategory[] = [];
  for (let cur: AdminCategory | undefined = c; cur; cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined) out.unshift(cur);
  return out;
}

/** The categories with their own markup, each with a button that removes it; nothing when there are none. */
export function CategoryMarkupChips({
  categories,
  value,
  onChange,
}: {
  categories: AdminCategory[];
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}) {
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const overrides = Object.keys(value)
    .map((id) => byId.get(Number(id)))
    .filter((c): c is AdminCategory => !!c);
  if (!overrides.length) return null;
  const remove = (id: number) => {
    const next = { ...value };
    delete next[id];
    onChange(next);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {overrides.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pr-1 pl-2.5 text-sm text-primary">
          {categoryPath(c, byId)
            .map((p) => p.name)
            .join(" › ")}
          : {value[c.id]}%
          <Button type="button" variant="ghost" size="icon-xs" className="rounded-full" onClick={() => remove(c.id)} aria-label="Убрать">
            <X />
          </Button>
        </span>
      ))}
    </div>
  );
}

/**
 * Markup per category. A category without its own value inherits the nearest parent's one,
 * and the default markup applies where no parent has one (the same rule as the backend).
 */
export function CategoryMarkups({
  categories,
  value,
  onChange,
  fallback,
}: {
  categories: AdminCategory[];
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
  fallback: number;
}) {
  const tree = useMemo(() => buildTree(categories), [categories]);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");

  const set = (id: number, v: string) => {
    const next = { ...value };
    if (v === "") delete next[id];
    else next[id] = Number(v);
    onChange(next);
  };
  const path = (c: AdminCategory) => categoryPath(c, byId);
  const inherited = (c: AdminCategory) => {
    for (const p of path(c).slice(0, -1).reverse()) if (value[p.id] != null) return { pct: value[p.id], from: p.name };
    return { pct: fallback, from: null };
  };

  const q = query.trim().toLowerCase();
  const matches = q ? categories.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 50) : [];
  const row = (c: AdminCategory, depth: number, hasChildren: boolean, label?: string) => {
    const own = value[c.id];
    const inh = inherited(c);
    return (
      <div className="flex items-center gap-2 py-1 pr-1" style={{ paddingLeft: depth * 18 }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((s) => (s.has(c.id) ? new Set([...s].filter((x) => x !== c.id)) : new Set(s).add(c.id)))}
            className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-muted"
            aria-label={expanded.has(c.id) ? "Свернуть" : "Развернуть"}
          >
            <ChevronRight className={cn("size-4 transition-transform", expanded.has(c.id) && "rotate-90")} />
          </button>
        ) : (
          <span className="size-6 shrink-0" />
        )}
        <span className={cn("min-w-0 flex-1 truncate text-sm", own != null && "font-medium")} title={label ?? c.name}>
          {label ?? c.name}
          <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{c.product_count}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Input
            type="number"
            min={0}
            step="0.1"
            value={own ?? ""}
            placeholder={Number.isFinite(inh.pct) ? String(inh.pct) : ""}
            onChange={(e) => set(c.id, e.target.value)}
            aria-invalid={own != null && !(own >= 0) ? true : undefined}
            className={cn("h-7 w-20 text-right tabular-nums", own != null && "border-primary/50 bg-primary/5")}
            aria-label={`Наценка для «${c.name}», %`}
            title={own != null ? "Своя наценка" : inh.from ? `Наследуется от «${inh.from}»` : "Общая наценка"}
          />
          <span className="w-3 text-xs text-muted-foreground">%</span>
        </div>
      </div>
    );
  };

  const renderNodes = (nodes: Node[], depth: number): React.ReactNode =>
    nodes.map((n) => (
      <div key={n.id}>
        {row(n, depth, n.children.length > 0)}
        {expanded.has(n.id) && renderNodes(n.children, depth + 1)}
      </div>
    ));

  return (
    <div className="space-y-4">
      <CategoryMarkupChips categories={categories} value={value} onChange={onChange} />
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти категорию" className="h-9 pl-9" />
      </div>
      <div className="max-h-[28rem] overflow-y-auto rounded-xl p-1 ring-1 ring-foreground/10">
        {q
          ? matches.length > 0
            ? matches.map((c) => (
                <div key={c.id}>
                  {row(
                    c,
                    0,
                    false,
                    path(c)
                      .map((p) => p.name)
                      .join(" › "),
                  )}
                </div>
              ))
            : <p className="p-3 text-sm text-muted-foreground">Ничего не найдено</p>
          : renderNodes(tree, 0)}
      </div>
    </div>
  );
}
