"use client";

import { useState } from "react";

import { useListing } from "@/components/catalog/listing-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import type { VendorFacet } from "@/lib/types";
import { cn } from "@/lib/utils";

export type FacetsProps = {
  vendors: VendorFacet[];
  priceMin: number | null;
  priceMax: number | null;
};

export function Filters({ vendors, priceMin, priceMax, className }: FacetsProps & { className?: string }) {
  const { query, navigate } = useListing();
  const active = query.vendors.length > 0 || query.min !== undefined || query.max !== undefined;
  return (
    <div className={cn("space-y-8", className)}>
      <PriceFilter
        key={`${query.min ?? ""}-${query.max ?? ""}`}
        min={query.min}
        max={query.max}
        rangeMin={priceMin}
        rangeMax={priceMax}
        onApply={(min, max) => navigate({ min, max })}
      />
      {(vendors.length > 0 || query.vendors.length > 0) && (
        <VendorFilter vendors={vendors} selected={query.vendors} onChange={(v) => navigate({ vendors: v })} />
      )}
      {active && (
        <Button variant="outline" className="h-9 w-full" onClick={() => navigate({ vendors: [], min: undefined, max: undefined })}>
          Сбросить фильтры
        </Button>
      )}
    </div>
  );
}

function toNumber(s: string): number | undefined {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function PriceFilter({
  min,
  max,
  rangeMin,
  rangeMax,
  onApply,
}: {
  min?: number;
  max?: number;
  rangeMin: number | null;
  rangeMax: number | null;
  onApply: (min?: number, max?: number) => void;
}) {
  const [from, setFrom] = useState(min ? String(min) : "");
  const [to, setTo] = useState(max ? String(max) : "");

  const apply = () => {
    let f = toNumber(from);
    let t = toNumber(to);
    if (f && t && f > t) [f, t] = [t, f];
    if (f !== min || t !== max) onApply(f, t);
  };

  return (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold">Цена, ₽</legend>
      <form
        className="grid grid-cols-2 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <Input
          inputMode="numeric"
          aria-label="Цена от"
          placeholder={rangeMin != null ? `от ${formatNumber(Math.floor(rangeMin))}` : "от"}
          value={from}
          onChange={(e) => setFrom(e.target.value.replace(/\D/g, ""))}
          onBlur={apply}
          className="h-9 tabular-nums"
        />
        <Input
          inputMode="numeric"
          aria-label="Цена до"
          placeholder={rangeMax != null ? `до ${formatNumber(Math.ceil(rangeMax))}` : "до"}
          value={to}
          onChange={(e) => setTo(e.target.value.replace(/\D/g, ""))}
          onBlur={apply}
          className="h-9 tabular-nums"
        />
        <button type="submit" hidden />
      </form>
    </fieldset>
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
