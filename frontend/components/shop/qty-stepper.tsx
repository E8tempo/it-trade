"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

/** The API's limit for one cart line. */
export const MAX_QTY = 99_999;

/** Whole packs only: rounds up to a multiple of `step` (the product's multiplicity), 1 pack .. MAX_QTY. */
export function packQty(qty: number, step: number): number {
  const top = Math.floor(MAX_QTY / step) * step;
  return Math.min(Math.max(Math.ceil(qty / step) * step, step), top);
}

const SIZES = {
  sm: { box: "h-9 rounded-xl", button: "size-9", input: "w-11 text-sm" },
  lg: { box: "h-11 rounded-xl", button: "size-11", input: "w-12 text-base" },
};

type Props = {
  value: number;
  /** the product's multiplicity: the quantity changes by whole packs */
  step?: number;
  onChange: (qty: number) => void;
  /** at the minimum the minus button turns into "remove" and calls onChange(0) */
  removable?: boolean;
  size?: keyof typeof SIZES;
  disabled?: boolean;
  /** what is counted, for screen readers: "Количество: Кабель USB" */
  label?: string;
  className?: string;
};

/** − [qty] + with direct input; typed values are rounded up to whole packs when the field is left. */
export function QtyStepper({ value, step = 1, onChange, removable, size = "sm", disabled, label = "Количество", className }: Props) {
  const [draft, setDraft] = useState<string | null>(null); // what is being typed; null = show `value`
  const s = SIZES[size];
  const top = Math.floor(MAX_QTY / step) * step;
  const atMin = value <= step;

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const n = Number.parseInt(draft, 10);
    if (!Number.isFinite(n) || n <= 0) return; // emptied or zero: keep the quantity, removing has its own button
    const qty = packQty(n, step);
    if (qty !== value) onChange(qty);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur(); // commits
    } else if (e.key === "Escape") {
      setDraft(null);
      e.currentTarget.blur();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      setDraft(null);
      const qty = packQty(value + (e.key === "ArrowUp" ? step : -step), step);
      if (qty !== value) onChange(qty);
    }
  };

  const button = cn(
    "grid shrink-0 place-items-center rounded-xl text-foreground/80 transition-colors outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-35",
    s.button,
  );

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center bg-muted/80 transition-shadow has-[input:focus]:ring-3 has-[input:focus]:ring-ring/40",
        s.box,
        disabled && "opacity-60",
        className,
      )}
    >
      {removable && atMin ? (
        <button type="button" className={cn(button, "hover:text-destructive")} disabled={disabled} onClick={() => onChange(0)} aria-label="Удалить из корзины">
          <Trash2 className="size-4" />
        </button>
      ) : (
        <button
          type="button"
          className={button}
          disabled={disabled || atMin}
          onClick={() => onChange(packQty(value - step, step))}
          aria-label={step > 1 ? `Уменьшить на ${step} шт.` : "Уменьшить количество"}
        >
          <Minus className="size-4" />
        </button>
      )}
      <input
        type="text"
        inputMode="numeric"
        enterKeyHint="done"
        autoComplete="off"
        aria-label="Количество, шт."
        disabled={disabled}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 5))}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={cn("h-full min-w-0 bg-transparent text-center font-medium tabular-nums outline-none", s.input)}
      />
      <button
        type="button"
        className={button}
        disabled={disabled || value >= top}
        onClick={() => onChange(packQty(value + step, step))}
        aria-label={step > 1 ? `Увеличить на ${step} шт.` : "Увеличить количество"}
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
