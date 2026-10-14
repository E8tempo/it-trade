"use client";

import { useId, type ReactNode } from "react";

import { PAYMENT, PAYMENT_METHODS } from "@/components/shop/labels";
import { formatPrice } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";
import { cn } from "@/lib/utils";

type ChoiceCardProps<T extends string> = {
  name: string;
  value: T;
  checked: boolean;
  onSelect: (value: T) => void;
  title: ReactNode;
  hint?: ReactNode;
  /** on the right of the title: a price, a total */
  aside?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** shown under the card's text when it is selected (no form fields: the card is a <label>) */
  children?: ReactNode;
};

/** A radio button as a card: a native input (keyboard, screen readers) under a custom look. */
export function ChoiceCard<T extends string>({ name, value, checked, onSelect, title, hint, aside, icon, disabled, children }: ChoiceCardProps<T>) {
  return (
    <label
      className={cn(
        "group/choice flex cursor-pointer gap-3 rounded-2xl border bg-background p-3.5 transition-colors hover:border-foreground/25 sm:p-4",
        "has-[:checked]:border-primary has-[:checked]:bg-primary/[0.035] has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onSelect(value)} className="sr-only" />
      <span
        aria-hidden
        className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border-2 border-foreground/25 transition-colors group-has-[:checked]/choice:border-primary"
      >
        <span className="size-2 scale-0 rounded-full bg-primary transition-transform group-has-[:checked]/choice:scale-100" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2 text-[15px] leading-snug font-medium">
            {icon}
            {title}
          </span>
          {aside && <span className="shrink-0 text-[15px] leading-snug font-semibold tabular-nums">{aside}</span>}
        </span>
        {hint && <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{hint}</span>}
        {checked && children}
      </span>
    </label>
  );
}

/** Cash / cashless, each with the order's total for it. */
export function PaymentChoice({
  value,
  onChange,
  totals,
  className,
}: {
  value: PaymentMethod;
  onChange: (payment: PaymentMethod) => void;
  totals: Record<PaymentMethod, number> | null;
  className?: string;
}) {
  // unique: pages kept alive for back navigation stay in the document with their radios
  const name = useId();
  return (
    <div role="radiogroup" aria-label="Способ оплаты" className={cn("grid gap-2", className)}>
      {PAYMENT_METHODS.map((m) => (
        <ChoiceCard
          key={m}
          name={name}
          value={m}
          checked={value === m}
          onSelect={onChange}
          title={PAYMENT[m].title}
          hint={PAYMENT[m].hint}
          aside={totals ? formatPrice(totals[m]) : undefined}
        />
      ))}
    </div>
  );
}
