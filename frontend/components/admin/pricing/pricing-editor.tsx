"use client";

import {
  ArrowUpToLine,
  Calculator,
  ChartNoAxesColumn,
  Coins,
  Copy,
  Ellipsis,
  FolderTree,
  LoaderCircle,
  Percent,
  SlidersHorizontal,
  Tag,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { CategoryMarkupChips, CategoryMarkups } from "@/components/admin/pricing/category-markups";
import { PriceCalculator } from "@/components/admin/pricing/price-calculator";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { apiErrorText } from "@/lib/admin/errors";
import { money } from "@/lib/admin/labels";
import { PRICE_TYPE, PRICE_TYPES } from "@/lib/admin/suppliers";
import type { AdminCategory, PriceImpact, PriceRules, PriceType, SupplierPricing } from "@/lib/admin/types";
import { api } from "@/lib/api/client";
import { formatNumber } from "@/lib/format";
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

const DIALOG = "max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto p-5 sm:max-w-xl sm:p-6";
const DIALOG_FOOT = "-mx-5 -mb-5 rounded-b-xl px-5 sm:-mx-6 sm:-mb-6 sm:px-6";

const HINT: Partial<Record<PriceType, string>> = {
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
  const [dialog, setDialogState] = useState<"impact" | "calculator" | "categories" | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const { label } = PRICE_TYPE[type];
  const saved = toDraft(pricing[type]);
  const dirty = !sameRules(draft, saved);
  const invalid = !validRules(draft); // NaN >= 0 is false: an empty field is invalid too
  const draftKey = JSON.stringify(draft);
  // the forecast is for the rules it was asked with: hidden once they change
  const shown = impact?.draft === draftKey ? impact.data : null;
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const steps = [...new Set([...ROUNDING_STEPS, draft.round_to])].sort((a, b) => a - b);
  const rounding = Object.fromEntries(steps.map((s) => [String(s), roundingLabel(s)]));
  const ownCategories = Object.keys(draft.category_markups).length;

  function setDialog(d: typeof dialog) {
    setDialogState(d);
    // the forecast is counted when its dialog opens, unless it is already there for these rules
    if (d === "impact" && !shown && !invalid) void checkImpact();
  }

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
    <section className="overflow-hidden rounded-2xl bg-background ring-1 ring-foreground/10">
      <header className="flex flex-col gap-3 border-b px-5 py-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="font-semibold">Правила «{label}»</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{HINT[type]}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDialog("impact")} disabled={invalid}>
            <ChartNoAxesColumn />
            Как изменятся цены
          </Button>
          <Button variant="outline" onClick={() => setDialog("calculator")}>
            <Calculator />
            Калькулятор
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Ещё" />}>
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-xl p-1.5">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Скопировать сохранённые правила</DropdownMenuLabel>
                {PRICE_TYPES.filter((t) => t.value !== type).map((t) => (
                  <DropdownMenuItem key={t.value} onClick={() => copyFrom(t.value)} className="gap-2.5 rounded-lg px-2.5 py-2">
                    <Copy />
                    {t.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="px-5 sm:px-6">
        <RuleRow icon={Percent} label="Наценка по умолчанию" hint="К закупке, если у категории товара нет своей наценки">
          <NumberInput
            value={draft.markup_percent}
            onChange={(v) => set({ markup_percent: v })}
            unit="%"
            step="0.1"
            label="Наценка по умолчанию, %"
          />
        </RuleRow>
        <RuleRow icon={Coins} label="Минимальная наценка" hint="Наценка в рублях не опускается ниже этой суммы">
          <NumberInput value={draft.min_markup} onChange={(v) => set({ min_markup: v })} unit="₽" label="Минимальная наценка, ₽" />
        </RuleRow>
        <RuleRow icon={ArrowUpToLine} label="Округление вверх" hint="Цена округляется вверх до этого шага">
          <Select items={rounding} value={String(draft.round_to)} onValueChange={(v) => v && set({ round_to: Number(v) })}>
            <SelectTrigger className="h-9 w-full sm:w-40" aria-label="Округление цены вверх">
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
        </RuleRow>
        <RuleRow
          icon={Tag}
          label="РРЦ поставщика"
          hint="Рекомендованная цена заменяет расчёт по наценке, если она не ниже закупки + минимальной наценки"
        >
          <label className="flex h-9 items-center gap-2.5 text-sm sm:w-40">
            <Switch checked={draft.use_rrp} onCheckedChange={(v) => set({ use_rrp: v })} />
            {draft.use_rrp ? "ставится" : "не ставится"}
          </label>
        </RuleRow>
        <RuleRow
          icon={FolderTree}
          label="Наценки по категориям"
          hint={
            ownCategories
              ? "Действуют на подкатегории, пока у тех нет своей"
              : "Своих нет: везде действует наценка по умолчанию"
          }
          below={<CategoryMarkupChips categories={categories} value={draft.category_markups} onChange={(category_markups) => set({ category_markups })} />}
        >
          <Button variant="outline" className="w-full sm:w-40" onClick={() => setDialog("categories")}>
            <SlidersHorizontal />
            Настроить
          </Button>
        </RuleRow>
      </div>

      <footer
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-5 py-3 sm:px-6",
          invalid ? "bg-destructive/5" : dirty ? "bg-amber-50" : "bg-muted/30",
        )}
        role="status"
      >
        <p className="min-w-0 flex-1 text-sm">
          {invalid ? (
            <span className="text-destructive">Наценки должны быть числами не меньше нуля — исправьте, чтобы сохранить.</span>
          ) : dirty ? (
            <>
              <span className="mr-2 inline-block size-2 rounded-full bg-amber-500 align-middle" aria-hidden />
              Изменения ещё не сохранены
            </>
          ) : (
            <span className="text-muted-foreground">Сохранено. Цены пересчитываются сразу после сохранения</span>
          )}
        </p>
        {dirty && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onChange(saved)} disabled={busy !== null || refreshing}>
              <Undo2 />
              Отменить
            </Button>
            <Button onClick={() => void save()} disabled={busy !== null || refreshing || invalid}>
              {(busy === "save" || refreshing) && <LoaderCircle className="animate-spin" />}
              Сохранить
            </Button>
          </div>
        )}
      </footer>

      <Dialog open={dialog === "impact"} onOpenChange={(o) => setDialog(o ? "impact" : null)}>
        <DialogContent className={DIALOG}>
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Как изменятся цены «{label}»</DialogTitle>
            <DialogDescription>
              Прогноз по правилам этой вкладки{dirty ? ", в том числе несохранённым" : ""}. Товары, у которых эта цена зафиксирована
              вручную, правила не затрагивают.
            </DialogDescription>
          </DialogHeader>
          {shown ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <Mini label="Изменятся" value={`${formatNumber(shown.changed)} из ${formatNumber(shown.products)}`} />
                <Mini label="Подорожают" value={formatNumber(shown.up)} />
                <Mini label="Подешевеют" value={formatNumber(shown.down)} />
              </div>
              <p>
                Средняя наценка: {shown.avg_markup_before}% → <b>{shown.avg_markup_after}%</b>
              </p>
              {shown.examples.length > 0 && (
                <ul className="max-h-72 divide-y overflow-y-auto rounded-xl ring-1 ring-foreground/10">
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
          ) : (
            <div className="grid h-40 place-items-center text-sm text-muted-foreground">
              {busy === "impact" ? <LoaderCircle className="size-5 animate-spin" /> : "Нет данных"}
            </div>
          )}
          <DialogFooter className={DIALOG_FOOT}>
            <Button variant="outline" onClick={() => void checkImpact()} disabled={busy !== null || invalid}>
              {busy === "impact" && <LoaderCircle className="animate-spin" />}
              Посчитать заново
            </Button>
            <DialogClose render={<Button />}>Готово</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "calculator"} onOpenChange={(o) => setDialog(o ? "calculator" : null)}>
        <DialogContent className={DIALOG}>
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Калькулятор цены «{label}»</DialogTitle>
            <DialogDescription>
              Считает по правилам этой вкладки, даже если они ещё не сохранены. Другая цена — по сохранённым правилам.
            </DialogDescription>
          </DialogHeader>
          <PriceCalculator categories={categories} supplier={supplier} priceType={type} settings={draft} disabled={invalid} />
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "categories"} onOpenChange={(o) => setDialog(o ? "categories" : null)}>
        <DialogContent className={cn(DIALOG, "sm:max-w-2xl")}>
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Наценки по категориям · {label}</DialogTitle>
            <DialogDescription>
              Своя наценка категории действует на все её подкатегории, пока у подкатегории нет своей. Пустое поле — наследовать (серым
              показано значение, которое действует сейчас). Изменения попадают в правила вкладки, сохраняются кнопкой «Сохранить».
            </DialogDescription>
          </DialogHeader>
          <CategoryMarkups
            categories={categories}
            value={draft.category_markups}
            onChange={(category_markups) => set({ category_markups })}
            fallback={draft.markup_percent}
          />
          <DialogFooter className={DIALOG_FOOT}>
            <DialogClose render={<Button />}>Готово</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** A rule: an icon, what it is with a hint, and its control on the right (under it on a phone). */
function RuleRow({
  icon: Icon,
  label,
  hint,
  below,
  children,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  below?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b py-4 last:border-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted">
            <Icon className="size-4 text-muted-foreground" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{label}</p>
            <p className="text-sm text-muted-foreground">{hint}</p>
          </div>
        </div>
        <div className="shrink-0 sm:pl-0">{children}</div>
      </div>
      {below && <div className="mt-3 sm:pl-13">{below}</div>}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  unit,
  step,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  unit: string;
  step?: string;
  label: string;
}) {
  return (
    <div className="relative sm:w-40">
      <Input
        type="number"
        min={0}
        step={step}
        value={shownNumber(value)}
        onChange={(e) => onChange(parse(e.target.value))}
        aria-invalid={!(value >= 0) || undefined}
        aria-label={label}
        className="h-9 [appearance:textfield] pr-8 tabular-nums [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">{unit}</span>
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
