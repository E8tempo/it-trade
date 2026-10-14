"use client";

import { LoaderCircle, TriangleAlert, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { PRICE_TYPE, PRICE_TYPES, priceType } from "@/lib/admin/suppliers";
import type { AdminCategory, PriceImpact, PriceRules, PriceType, SupplierPricing } from "@/lib/admin/types";
import { api } from "@/lib/api/client";
import { formatNumber, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Rules as the form edits them: numbers, while the API sends the decimals as strings ("20.0").
 * A field the admin has cleared is NaN until it is filled again, so it shows empty instead of a 0 nobody typed.
 */
export type Draft = {
  markup_percent: number;
  min_markup: number;
  round_to: number;
  use_rrp: boolean;
  category_markups: Record<string, number>;
};

export function toDraft(r: PriceRules): Draft {
  return {
    markup_percent: Number(r.markup_percent),
    min_markup: Number(r.min_markup),
    round_to: r.round_to,
    use_rrp: r.use_rrp,
    category_markups: Object.fromEntries(Object.entries(r.category_markups).map(([k, v]) => [k, Number(v)])),
  };
}

// Drafts always list their keys in the same order (category ids are integer keys, which JS sorts), so JSON compares them.
export const sameRules = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

const validRules = (d: Draft) => [d.markup_percent, d.min_markup, ...Object.values(d.category_markups)].every((v) => v >= 0);
const parse = (v: string) => (v.trim() === "" ? NaN : Number(v));
const shownNumber = (v: number) => (Number.isNaN(v) ? "" : v);

export const roundingLabel = (step: number) => (step === 1 ? "до рубля" : `до ${formatNumber(step)} ₽`);

const ROUNDING_STEPS = [1, 10, 50, 100];

const HINT: Record<PriceType, string> = {
  retail_cash: "Розничная цена за наличные. Сайт работает только с бизнесом, поэтому клиентам она не видна: она для справки и заказов из админки, по ней сортируется каталог «по цене».",
  retail_cashless: "Розничная цена по безналу. Клиентам на сайте не видна: она для справки и заказов из админки.",
  wholesale_cash: "Цена для клиентов при оплате наличными: её видят сотрудники подтверждённой организации во всём каталоге.",
  wholesale_cashless: "Цена для клиентов по безналу (по счёту на организацию): её видят сотрудники подтверждённой организации.",
};

/**
 * Markup rules of one price type of a supplier. The draft is kept by the parent (one per tab); unsaved rules
 * can already be checked against the catalog and tried in the calculator.
 */
export function PricingEditor({
  supplier,
  type,
  pricing,
  categories,
  draft,
  onChange,
}: {
  supplier: string;
  type: PriceType;
  pricing: SupplierPricing; // the saved rules of every type
  categories: AdminCategory[];
  draft: Draft;
  onChange: (draft: Draft) => void;
}) {
  const router = useRouter();
  const [impact, setImpact] = useState<{ draft: string; data: PriceImpact } | null>(null);
  const [busy, setBusy] = useState<"impact" | "save" | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const { label, audience, payment } = PRICE_TYPE[type];
  const saved = toDraft(pricing[type]);
  const dirty = !sameRules(draft, saved);
  const invalid = !validRules(draft); // NaN >= 0 is false: an empty field is invalid too
  const draftKey = JSON.stringify(draft);
  // the forecast is for the rules it was asked with: hidden once they change
  const shown = impact?.draft === draftKey ? impact.data : null;
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const steps = [...new Set([...ROUNDING_STEPS, draft.round_to])].sort((a, b) => a - b);
  const rounding = Object.fromEntries(steps.map((s) => [String(s), roundingLabel(s)]));

  function copyFrom(from: PriceType) {
    const rules = toDraft(pricing[from]);
    const name = PRICE_TYPE[from].label;
    if (sameRules(rules, draft)) {
      toast(`Правила уже такие же, как у «${name}»`);
      return;
    }
    onChange(rules);
    toast.success(`Скопированы сохранённые правила «${name}». Проверьте их и сохраните`);
  }

  async function checkImpact() {
    setBusy("impact");
    try {
      const data = await api<PriceImpact>("/api/admin/pricing/impact", {
        method: "POST",
        body: JSON.stringify({ supplier, price_type: type, settings: draft }),
      });
      setImpact({ draft: draftKey, data });
    } catch (e) {
      toast.error(apiErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      await api<SupplierPricing>(`/api/admin/suppliers/${supplier}/pricing/${type}`, { method: "PUT", body: JSON.stringify(draft) });
      toast.success(`Правила «${label}» сохранены, цены пересчитываются (несколько секунд)`);
      setImpact(null);
      // the page reads the saved rules again; until it has, the button stays disabled
      startRefresh(() => router.refresh());
    } catch (e) {
      toast.error(apiErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="max-w-3xl text-sm text-muted-foreground">{HINT[type]}</p>
        <Select value={null} onValueChange={(v) => v && copyFrom(v as PriceType)}>
          <SelectTrigger className="h-9 w-full shrink-0 bg-background md:w-64" aria-label="Скопировать сохранённые правила другой цены">
            <SelectValue placeholder="Скопировать правила из…" />
          </SelectTrigger>
          <SelectContent>
            {PRICE_TYPES.filter((t) => t.value !== type).map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Panel title="Общие правила">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Наценка по умолчанию, %">
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={shownNumber(draft.markup_percent)}
                  onChange={(e) => set({ markup_percent: parse(e.target.value) })}
                  aria-invalid={!(draft.markup_percent >= 0) || undefined}
                  className="h-9"
                />
              </Field>
              <Field label="Минимальная наценка, ₽">
                <Input
                  type="number"
                  min={0}
                  value={shownNumber(draft.min_markup)}
                  onChange={(e) => set({ min_markup: parse(e.target.value) })}
                  aria-invalid={!(draft.min_markup >= 0) || undefined}
                  className="h-9"
                />
              </Field>
              <Field label="Округление цены вверх">
                <Select items={rounding} value={String(draft.round_to)} onValueChange={(v) => v && set({ round_to: Number(v) })}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(rounding).map(([k, text]) => (
                      <SelectItem key={k} value={k}>
                        {text}
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
          <Panel title="Как изменятся цены">
            <p className="text-sm text-muted-foreground">
              Прогноз для цены «{label}» по правилам этой вкладки, в том числе несохранённым: сколько товаров подорожает и подешевеет.
              Товары, у которых эта цена зафиксирована вручную, правила не затрагивают.
            </p>
            <Button variant="outline" className="mt-4" onClick={checkImpact} disabled={busy !== null || invalid}>
              {busy === "impact" && <LoaderCircle className="animate-spin" />}
              {shown ? "Посчитать заново" : "Посчитать"}
            </Button>
            {shown && (
              <div className="mt-5 space-y-3 text-sm">
                <div className="grid grid-cols-3 gap-2">
                  <Mini label="Изменятся" value={`${formatNumber(shown.changed)} из ${formatNumber(shown.products)}`} />
                  <Mini label="Подорожают" value={formatNumber(shown.up)} />
                  <Mini label="Подешевеют" value={formatNumber(shown.down)} />
                </div>
                <p>
                  Средняя наценка: {shown.avg_markup_before}% → <b>{shown.avg_markup_after}%</b>
                </p>
                {audience === "wholesale" && shown.above_retail != null && shown.above_retail > 0 && (
                  <div className="flex gap-2.5 rounded-xl bg-amber-500/10 px-3 py-2.5 text-amber-900 ring-1 ring-amber-500/25">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <p>
                      У {formatNumber(shown.above_retail)} {pluralize(shown.above_retail, ["товара", "товаров", "товаров"])} оптовая цена
                      выше розничной
                      <span className="block text-xs opacity-80">
                        По этим правилам, в сравнении с нынешней ценой «{PRICE_TYPE[priceType("retail", payment)].label}».
                      </span>
                    </p>
                  </div>
                )}
                {shown.examples.length > 0 && (
                  <ul className="divide-y rounded-xl ring-1 ring-foreground/10">
                    {shown.examples.map((e) => (
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
            <p className="mb-4 text-sm text-muted-foreground">
              Считает по правилам этой вкладки, даже если они ещё не сохранены. Остальные три цены — по сохранённым правилам.
            </p>
            <PriceCalculator categories={categories} supplier={supplier} priceType={type} settings={draft} disabled={invalid} />
          </Panel>
        </div>
      </div>

      <SaveBar
        label={label}
        dirty={dirty}
        invalid={invalid}
        busy={busy !== null || refreshing}
        onSave={() => void save()}
        onRevert={() => onChange(saved)}
      />
    </div>
  );
}

/**
 * Saving the rules of this tab: pinned to the bottom of the screen while the tab is in view, so it is always clear
 * which rules the button saves and whether they have unsaved changes.
 */
function SaveBar({
  label,
  dirty,
  invalid,
  busy,
  onSave,
  onRevert,
}: {
  label: string;
  dirty: boolean;
  invalid: boolean;
  busy: boolean;
  onSave: () => void;
  onRevert: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-20 mt-6">
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3 shadow-lg ring-1 backdrop-blur",
          dirty ? "bg-amber-50/95 ring-amber-500/30" : "bg-background/95 ring-foreground/10",
        )}
        role="status"
      >
        <p className="min-w-0 flex-1 text-sm">
          {invalid ? (
            <span className="text-destructive">Наценки должны быть числами не меньше нуля — исправьте, чтобы сохранить.</span>
          ) : dirty ? (
            <>
              <span className="mr-2 inline-block size-2 rounded-full bg-amber-500 align-middle" aria-hidden />
              Правила «{label}» изменены и ещё не сохранены
            </>
          ) : (
            <span className="text-muted-foreground">Правила «{label}» сохранены</span>
          )}
        </p>
        <div className="flex gap-2">
          {dirty && (
            <Button variant="ghost" onClick={onRevert} disabled={busy}>
              <Undo2 />
              Отменить
            </Button>
          )}
          <Button onClick={onSave} disabled={busy || !dirty || invalid}>
            {busy && <LoaderCircle className="animate-spin" />}
            Сохранить правила «{label}»
          </Button>
        </div>
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
