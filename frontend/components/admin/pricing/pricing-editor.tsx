"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/admin/orders/order-fields";
import { CategoryMarkups } from "@/components/admin/pricing/category-markups";
import { PriceCalculator } from "@/components/admin/pricing/price-calculator";
import { Panel } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { apiErrorText } from "@/lib/admin/errors";
import { money } from "@/lib/admin/labels";
import type { AdminCategory, PriceImpact, PricingSettings } from "@/lib/admin/types";
import { api } from "@/lib/api/client";

type Draft = {
  markup_percent: number;
  min_markup: number;
  round_to: number;
  use_rrp: boolean;
  category_markups: Record<string, number>;
};

const ROUNDING = { "1": "до рубля", "10": "до 10 ₽", "50": "до 50 ₽", "100": "до 100 ₽" };

function toDraft(s: PricingSettings): Draft {
  return {
    markup_percent: Number(s.markup_percent),
    min_markup: Number(s.min_markup),
    round_to: s.round_to,
    use_rrp: s.use_rrp,
    category_markups: Object.fromEntries(Object.entries(s.category_markups).map(([k, v]) => [k, Number(v)])),
  };
}

export function PricingEditor({ settings, categories }: { settings: PricingSettings; categories: AdminCategory[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(toDraft(settings));
  const [impact, setImpact] = useState<PriceImpact | null>(null);
  const [busy, setBusy] = useState<"impact" | "save" | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings));
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setImpact(null);
  };

  async function checkImpact() {
    setBusy("impact");
    try {
      setImpact(await api<PriceImpact>("/api/admin/pricing/impact", { method: "POST", body: JSON.stringify({ settings: draft }) }));
    } catch (e) {
      toast.error(apiErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      await api("/api/admin/settings/pricing", { method: "PUT", body: JSON.stringify(draft) });
      toast.success("Правила сохранены, цены пересчитываются (несколько секунд)");
      setImpact(null);
      router.refresh();
    } catch (e) {
      toast.error(apiErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-6">
        <Panel title="Общие правила">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Наценка по умолчанию, %">
              <Input type="number" min={0} step="0.1" value={draft.markup_percent} onChange={(e) => set({ markup_percent: Number(e.target.value) })} className="h-9" />
            </Field>
            <Field label="Минимальная наценка, ₽">
              <Input type="number" min={0} value={draft.min_markup} onChange={(e) => set({ min_markup: Number(e.target.value) })} className="h-9" />
            </Field>
            <Field label="Округление цены вверх">
              <Select items={ROUNDING} value={String(draft.round_to)} onValueChange={(v) => v && set({ round_to: Number(v) })}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROUNDING).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <label className="mt-5 flex items-start gap-3">
            <Switch checked={draft.use_rrp} onCheckedChange={(v) => set({ use_rrp: v })} className="mt-0.5" />
            <span className="text-sm">
              <span className="font-medium">Ставить РРЦ поставщика, если она есть</span>
              <span className="block text-muted-foreground">
                Рекомендованная розничная цена заменяет расчёт по наценке, если она не ниже закупки + минимальной наценки.
              </span>
            </span>
          </label>
        </Panel>

        <Panel title="Наценки по категориям">
          <p className="mb-4 text-sm text-muted-foreground">
            Своя наценка категории действует на все её подкатегории, пока у подкатегории нет своей. Пустое поле — наследовать (серым
            показано значение, которое действует сейчас).
          </p>
          <CategoryMarkups
            categories={categories}
            value={draft.category_markups}
            onChange={(category_markups) => set({ category_markups })}
            fallback={draft.markup_percent}
          />
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel title="Применить">
          <p className="text-sm text-muted-foreground">
            Перед сохранением можно посмотреть, как изменятся цены. Товары с фиксированной ценой правила не затрагивают.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={checkImpact} disabled={busy !== null}>
              {busy === "impact" && <LoaderCircle className="animate-spin" />}
              Как изменятся цены
            </Button>
            <Button onClick={save} disabled={busy !== null || !dirty}>
              {busy === "save" && <LoaderCircle className="animate-spin" />}
              Сохранить правила
            </Button>
          </div>
          {impact && (
            <div className="mt-5 space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <Mini label="Изменятся" value={`${impact.changed} из ${impact.products}`} />
                <Mini label="Подорожают" value={String(impact.up)} />
                <Mini label="Подешевеют" value={String(impact.down)} />
              </div>
              <p>
                Средняя наценка: {impact.avg_markup_before}% → <b>{impact.avg_markup_after}%</b>
              </p>
              {impact.examples.length > 0 && (
                <ul className="divide-y rounded-xl ring-1 ring-foreground/10">
                  {impact.examples.map((e) => (
                    <li key={e.sku} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="line-clamp-1 min-w-0">{e.name}</span>
                      <span className="shrink-0 whitespace-nowrap tabular-nums">
                        <span className="text-muted-foreground">{money(e.before)}</span> → <b>{money(e.after)}</b>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Калькулятор цены">
          <p className="mb-4 text-sm text-muted-foreground">Считает по правилам на этой странице, даже если они ещё не сохранены.</p>
          <PriceCalculator categories={categories} settings={draft} />
        </Panel>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}
