"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import { useEffect, useState, type ReactNode } from "react";

import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { cn } from "@/lib/utils";

// The parts the step-by-step forms share (the registration, the password reset): the step's heading under a
// progress bar, and the cells of a code sent to an e-mail.

/** The progress bar, «<flow> · шаг N из M», the step's heading and its lead. */
export function StepHeader({
  flow,
  step,
  steps,
  title,
  lead,
  as: Heading = "h1",
}: {
  flow: string;
  step: number; // from 0
  steps: number;
  title: string;
  lead?: ReactNode;
  as?: "h1" | "h2";
}) {
  return (
    <div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps}, minmax(0, 1fr))` }} aria-hidden>
        {Array.from({ length: steps }, (_, i) => (
          <span key={i} className={cn("h-1 rounded-full transition-colors duration-300", i <= step ? "bg-primary" : "bg-muted")} />
        ))}
      </div>
      <p className="mt-5 text-[13px] text-muted-foreground tabular-nums">
        {flow} · шаг {step + 1} из {steps}
      </p>
      <Heading className="mt-1 text-[24px] leading-tight font-semibold tracking-tight">{title}</Heading>
      {lead && <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{lead}</p>}
    </div>
  );
}

/** «Отправили 6 цифр на <address>»: the lead of a code step. */
export function SentTo({ email }: { email: string }) {
  return (
    <>
      Отправили 6 цифр на <span className="font-medium break-all text-foreground">{email}</span>
    </>
  );
}

const SLOT = "size-12 text-xl font-semibold first:rounded-l-xl last:rounded-r-xl sm:size-13";

/**
 * Six cells for the code (3 + 3): digits only, a pasted code fills them all, the sixth one calls `onComplete`.
 * Under them the error, and «Не пришло? … отправьте снова (через N с). Другой e-mail».
 */
export function CodeCells({
  name,
  value,
  onChange,
  onComplete,
  error,
  resendIn,
  onResend,
  onOtherEmail,
  disabled,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  onComplete: () => void;
  error?: string;
  resendIn: number; // seconds until another code; 0: now
  onResend: () => void;
  onOtherEmail?: () => void; // none: the address cannot be changed here
  disabled?: boolean;
}) {
  const invalid = error ? true : undefined;
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2">
        <InputOTP
          name={name}
          maxLength={6}
          pattern={REGEXP_ONLY_DIGITS}
          inputMode="numeric"
          autoComplete="one-time-code"
          value={value}
          onChange={onChange}
          onComplete={() => !disabled && onComplete()}
          aria-label="Код из письма"
          aria-invalid={invalid}
          aria-describedby={error ? `${name}-error` : undefined}
        >
          <InputOTPGroup>
            {[0, 1, 2].map((i) => (
              <InputOTPSlot key={i} index={i} aria-invalid={invalid} className={SLOT} />
            ))}
          </InputOTPGroup>
          <InputOTPSeparator className="px-1 text-muted-foreground" />
          <InputOTPGroup>
            {[3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} aria-invalid={invalid} className={SLOT} />
            ))}
          </InputOTPGroup>
        </InputOTP>
        {error && (
          <p id={`${name}-error`} className="text-center text-[13px] text-destructive">
            {error}
          </p>
        )}
      </div>
      <p className="text-center text-sm text-muted-foreground">
        Не пришло? Проверьте «Спам» или{" "}
        {resendIn > 0 ? (
          <span className="tabular-nums">отправьте снова через {resendIn} с</span>
        ) : (
          <button type="button" disabled={disabled} onClick={onResend} className="font-medium text-primary hover:underline">
            отправьте снова
          </button>
        )}
        .
        {onOtherEmail && (
          <>
            {" "}
            <button type="button" onClick={onOtherEmail} className="font-medium text-primary hover:underline">
              Другой e-mail
            </button>
          </>
        )}
      </p>
    </div>
  );
}

/** Seconds left until `at` (ms), ticking once a second while `active`. */
export function useCountdown(at: number | null, active: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active || at === null) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [at, active]);
  return at === null || now === 0 ? 0 : Math.max(0, Math.ceil((at - now) / 1000));
}
