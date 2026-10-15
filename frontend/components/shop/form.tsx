"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Inputs of the shop's forms: taller than the admin panel's, comfortable for a thumb. */
export const FIELD = "h-11 rounded-xl px-3.5";
/** The main button of a form: as tall as the fields. */
export const SUBMIT = "h-11 w-full gap-2 rounded-xl text-[15px]";

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** Label, the input (children) and its error or hint. Give the input `{...describedBy(id, error, hint)}`. */
export function Field({
  id,
  label,
  optional,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  optional?: boolean;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="gap-1.5">
        {label}
        {optional && <span className="font-normal text-muted-foreground">(необязательно)</span>}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[13px] text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function describedBy(id: string, error?: string, hint?: boolean) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  };
}

export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? "text" : "password"} className={cn(FIELD, "pr-12", className)} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Скрыть пароль" : "Показать пароль"}
        aria-pressed={shown}
        className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/** An error of the whole form (wrong password, no connection). */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl bg-destructive/8 px-3.5 py-3 text-sm text-destructive">
      {children}
    </div>
  );
}

// --- checks shared by the forms --------------------------------------------------------------

export function emailError(value: string, required: boolean): string | undefined {
  const v = value.trim();
  if (!v) return required ? "Укажите e-mail" : undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Проверьте e-mail: похоже, в нём опечатка";
  if (v.length > 254) return "Слишком длинный e-mail";
  return undefined;
}

// The API takes 5..32 characters; a Russian number with its code has 10-11 digits, and a shorter
// one (a typo, a local number without the code) would leave the manager without a way to call.
export function phoneError(value: string, required: boolean): string | undefined {
  const v = value.trim();
  if (!v) return required ? "Укажите телефон, по нему менеджер подтвердит заказ" : undefined;
  if (v.length > 32) return "Слишком длинный номер";
  if (v.replace(/\D/g, "").length < 10) return "Укажите номер полностью, с кодом: +7 978 123-45-67";
  return undefined;
}

export const PASSWORD_MIN = 8;
