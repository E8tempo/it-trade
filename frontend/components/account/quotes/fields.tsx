"use client";

import { useRef, useState, type ComponentProps } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** "12,5" or "1 250.50" -> a number; "" -> null; undefined when it is not a number. */
export function parseNumber(text: string): number | null | undefined {
  const t = text.replace(/[\s ₽%]/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** A number for an input: "12,5", without trailing zeros. */
export function numberText(n: number | null | undefined): string {
  return n == null ? "" : String(n).replace(".", ",");
}

type Commit = (text: string) => void | Promise<unknown>;
// multiline: a textarea that grows with the text; "wrap" is one that only wraps a long line (Enter saves)
type CommitProps = { value: string; onCommit: Commit; multiline?: boolean | "wrap" };

/**
 * An input that saves when the client is done with it: on leaving it or Enter (Escape gives the saved value back).
 * Until then it keeps what is typed, and while it is being saved too; afterwards it shows the saved value.
 */
export function CommitInput({ value, onCommit, multiline, ...props }: CommitProps & Omit<ComponentProps<"input">, "value" | "onChange">) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const cancelled = useRef(false);
  const common = {
    value: draft ?? saving ?? value,
    onFocus: () => {
      cancelled.current = false;
      setDraft(saving ?? value);
    },
    onBlur: () => {
      if (draft !== null && !cancelled.current && draft.trim() !== value.trim()) {
        const text = draft.trim();
        const done = onCommit(text);
        if (done) {
          setSaving(text);
          void done.finally(() => setSaving((s) => (s === text ? null : s)));
        }
      }
      setDraft(null);
    },
  };
  if (multiline) {
    return (
      <Textarea
        {...common}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && multiline === "wrap") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        rows={multiline === "wrap" ? 1 : undefined}
        placeholder={props.placeholder}
        id={props.id}
        className={props.className}
        maxLength={props.maxLength}
        aria-label={props["aria-label"]}
      />
    );
  }
  return (
    <Input
      {...props}
      {...common}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** CommitInput for a number: an empty input is null (when `nullable`), anything else that is not a number is refused. */
export function NumberInput({
  value,
  onCommit,
  nullable,
  min = 0,
  max,
  what = "число",
  ...props
}: {
  value: number | null;
  onCommit: (n: number | null) => void | Promise<unknown>;
  nullable?: boolean;
  min?: number;
  max?: number;
  what?: string;
} & Omit<ComponentProps<"input">, "value" | "onChange" | "min" | "max">) {
  return (
    <CommitInput
      inputMode="decimal"
      autoComplete="off"
      {...props}
      value={numberText(value)}
      onCommit={(text) => {
        const n = parseNumber(text);
        if (n === undefined || (n === null && !nullable) || (n !== null && (n < min || (max !== undefined && n > max)))) {
          toast.error(`Проверьте ${what}`);
          return;
        }
        return onCommit(n);
      }}
    />
  );
}
