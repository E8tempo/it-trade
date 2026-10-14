"use client";

import { useEffect, useState } from "react";

import { PricingEditor, sameRules, toDraft } from "@/components/admin/pricing/pricing-editor";
import { PricingSummary, type PriceExample } from "@/components/admin/pricing/pricing-summary";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PRICE_TYPES } from "@/lib/admin/suppliers";
import type { AdminCategory, PriceType, SupplierPricing } from "@/lib/admin/types";

type PerType<T> = Record<PriceType, T>;

const perType = <T,>(f: (t: PriceType) => T) => Object.fromEntries(PRICE_TYPES.map((t) => [t.value, f(t.value)])) as PerType<T>;

/**
 * Markup rules of a supplier: a summary of the 4 price types and a tab with the editor of each. The drafts are
 * kept here and the tabs stay mounted, so switching tabs loses nothing; a tab with unsaved changes is marked.
 */
export function SupplierPricingEditor({
  supplier,
  pricing,
  categories,
  example,
  initialType,
}: {
  supplier: string;
  pricing: SupplierPricing;
  categories: AdminCategory[];
  example: PriceExample;
  initialType: PriceType;
}) {
  const [type, setType] = useState(initialType);
  const [drafts, setDrafts] = useState(() => perType((t) => toDraft(pricing[t])));
  // After a save the page reads the rules again. A tab without own changes takes the saved rules (they may
  // have been changed by someone else), a tab with changes keeps them.
  const [seen, setSeen] = useState(pricing);
  if (seen !== pricing) {
    setSeen(pricing);
    setDrafts((ds) => perType((t) => (sameRules(ds[t], toDraft(seen[t])) ? toDraft(pricing[t]) : ds[t])));
  }
  const dirty = perType((t) => !sameRules(drafts[t], toDraft(pricing[t])));
  const anyDirty = Object.values(dirty).some(Boolean);

  // unsaved rules: ask before the browser tab is closed or reloaded
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  function select(t: PriceType) {
    setType(t);
    // the tab goes to the URL without a request to the server, so a reload opens it again
    window.history.replaceState(null, "", t === PRICE_TYPES[0].value ? window.location.pathname : `?type=${t}`);
  }

  return (
    <div className="space-y-6">
      <PricingSummary pricing={pricing} example={example} dirty={dirty} active={type} onSelect={select} />
      <Tabs value={type} onValueChange={(v) => select(v as PriceType)}>
        <div className="no-scrollbar -mx-1 overflow-x-auto px-1 pb-1">
          <TabsList>
            {PRICE_TYPES.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="px-3">
                <span className="sm:hidden">{t.short}</span>
                <span className="hidden sm:inline">{t.label}</span>
                {dirty[t.value] && (
                  <>
                    <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
                    <span className="sr-only">(есть несохранённые изменения)</span>
                  </>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {PRICE_TYPES.map((t) => (
          <TabsContent key={t.value} value={t.value} keepMounted className="mt-4">
            <PricingEditor
              supplier={supplier}
              type={t.value}
              pricing={pricing}
              categories={categories}
              draft={drafts[t.value]}
              onChange={(d) => setDrafts((ds) => ({ ...ds, [t.value]: d }))}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
