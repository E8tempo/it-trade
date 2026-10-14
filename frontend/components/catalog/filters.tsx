"use client";

import { useState } from "react";

import { useListing } from "@/components/catalog/listing-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { VendorFacet } from "@/lib/types";
import { cn } from "@/lib/utils";

// No price filter: the catalog shows no prices to guests, and a client's prices are their organization's.
export type FacetsProps = {
  vendors: VendorFacet[];
};

export function Filters({ vendors, className }: FacetsProps & { className?: string }) {
  const { query, navigate } = useListing();
  const active = query.vendors.length > 0;
  return (
    <div className={cn("space-y-8", className)}>
      {(vendors.length > 0 || query.vendors.length > 0) && (
        <VendorFilter vendors={vendors} selected={query.vendors} onChange={(v) => navigate({ vendors: v })} />
      )}
      {active && (
        <Button variant="outline" className="h-9 w-full" onClick={() => navigate({ vendors: [] })}>
          Сбросить фильтры
        </Button>
      )}
    </div>
  );
}

const VISIBLE = 8;

function VendorFilter({
  vendors,
  selected,
  onChange,
}: {
  vendors: VendorFacet[];
  selected: string[];
  onChange: (vendors: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");

  // selected brands first (also ones that are not among the facets any more), then by count
  const known = new Set(vendors.map((v) => v.name));
  const all = [
    ...selected.filter((s) => !known.has(s)).map((name) => ({ name, count: 0 })),
    ...vendors,
  ].sort((a, b) => Number(selected.includes(b.name)) - Number(selected.includes(a.name)));
  const needle = search.trim().toLowerCase();
  const matching = needle ? all.filter((v) => v.name.toLowerCase().includes(needle)) : all;
  const visible = expanded || needle ? matching : matching.slice(0, Math.max(VISIBLE, selected.length));

  const toggle = (name: string, on: boolean) =>
    onChange(on ? [...selected, name].sort() : selected.filter((s) => s !== name));

  return (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold">Бренд</legend>
      {all.length > 12 && (
        <Input
          type="search"
          placeholder="Найти бренд"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2 h-9"
        />
      )}
      <ul className="-mx-1.5 space-y-px">
        {visible.map((v) => {
          const checked = selected.includes(v.name);
          return (
            <li key={v.name}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-sm transition-colors hover:bg-muted">
                <Checkbox checked={checked} onCheckedChange={(on) => toggle(v.name, on)} />
                <span className="flex-1 truncate">{v.name}</span>
                {v.count > 0 && <span className="text-xs text-muted-foreground tabular-nums">{v.count}</span>}
              </label>
            </li>
          );
        })}
        {needle && matching.length === 0 && <li className="px-1.5 py-1.5 text-sm text-muted-foreground">Не найдено</li>}
      </ul>
      {!needle && matching.length > visible.length && (
        <button type="button" onClick={() => setExpanded(true)} className="mt-2 text-sm font-medium text-primary hover:underline">
          Показать все ({matching.length})
        </button>
      )}
      {!needle && expanded && matching.length > VISIBLE && (
        <button type="button" onClick={() => setExpanded(false)} className="mt-2 text-sm font-medium text-primary hover:underline">
          Свернуть
        </button>
      )}
    </fieldset>
  );
}
