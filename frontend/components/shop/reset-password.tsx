"use client";

import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { CodeCells, SentTo, StepHeader, useCountdown } from "@/components/shop/code-steps";
import { errorMessage, hasStatus } from "@/components/shop/errors";
import { describedBy, emailError, Field, FIELD, FormError, PASSWORD_MIN, PasswordInput, SUBMIT } from "@/components/shop/form";
import { useSession } from "@/components/shop/session-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const TITLES = ["Восстановление пароля", "Подтвердите почту", "Новый пароль"];
const EMAIL = 0;
const CODE = 1;
const PASSWORD = 2;

type Errors = { email?: string; code?: string; password?: string };

/**
 * «Забыли пароль?» in three steps, like the registration: the e-mail, the code sent to it (checked at once), the new
 * password. Then the client is signed in, and the login page takes them on.
 */
export function ResetPasswordDialog({
  open,
  onOpenChange,
  initialEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialEmail: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-3xl p-6 sm:max-w-[27rem] sm:p-8">
        <DialogTitle className="sr-only">Восстановление пароля</DialogTitle>
        {/* mounted while open: every time from the first step */}
        <ResetForm initialEmail={initialEmail} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ResetForm({ initialEmail, onDone }: { initialEmail: string; onDone: () => void }) {
  const { login } = useSession();
  const [step, setStep] = useState(EMAIL);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<{ email: string; resendAt: number } | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const resendIn = useCountdown(sent?.resendAt ?? null, step === CODE);

  // the first field of a step that opens
  useEffect(() => {
    const name = ["email", "reset-code", "new-password"][step];
    formRef.current?.querySelector<HTMLInputElement>(`[name="${name}"]`)?.focus();
  }, [step]);

  function goTo(next: number) {
    setError(null);
    setStep(next);
  }

  async function sendCode() {
    const address = email.trim().toLowerCase();
    const bad = emailError(address, true);
    setErrors({ email: bad });
    if (bad) return;
    setPending(true);
    setError(null);
    try {
      const r = await api<{ email: string; resend_in: number }>("/api/auth/password/code", { method: "POST", body: JSON.stringify({ email: address }) });
      setSent({ email: r.email, resendAt: Date.now() + r.resend_in * 1000 });
      setCode("");
      goTo(CODE);
    } catch (err) {
      setError(errorMessage(err, "Не удалось отправить код. Попробуйте ещё раз."));
    } finally {
      setPending(false);
    }
  }

  async function checkCode() {
    if (!/^\d{6}$/.test(code)) return setErrors({ code: "Введите 6 цифр из письма" });
    setPending(true);
    try {
      await api("/api/auth/password/check", { method: "POST", body: JSON.stringify({ email: sent?.email, code }) });
      setErrors({});
      goTo(PASSWORD);
    } catch (err) {
      setErrors({ code: errorMessage(err, "Не удалось проверить код. Попробуйте ещё раз.") });
      setCode("");
    } finally {
      setPending(false);
    }
  }

  async function savePassword(form: HTMLFormElement) {
    const password = String(new FormData(form).get("new-password") ?? "");
    const bad = password.length < PASSWORD_MIN ? `Пароль должен быть не короче ${PASSWORD_MIN} символов` : password.length > 128 ? "Слишком длинный пароль" : undefined;
    setErrors({ password: bad });
    if (bad || !sent) return;
    setPending(true);
    setError(null);
    try {
      await api("/api/auth/password/reset", { method: "POST", body: JSON.stringify({ email: sent.email, code, new_password: password }) });
      await login(sent.email, password); // the login page then takes the client on
      onDone();
    } catch (err) {
      if (hasStatus(err, 400)) {
        // the code ran out meanwhile: back to it
        setErrors({ code: errorMessage(err, "Код устарел. Запросите новый.") });
        setCode("");
        goTo(CODE);
      } else {
        setError(errorMessage(err, "Не удалось сменить пароль. Попробуйте ещё раз."));
      }
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (step === EMAIL) void sendCode();
    else if (step === CODE) void checkCode();
    else void savePassword(e.currentTarget);
  }

  const back = (
    <Button type="button" variant="outline" className="h-11 rounded-xl px-4" onClick={() => goTo(step - 1)} disabled={pending} aria-label="Назад">
      <ArrowLeft />
    </Button>
  );
  const lead = [
    "Пришлём код на почту, с которой вы входите.",
    sent ? <SentTo key="sent" email={sent.email} /> : null,
    "Остальные входы в кабинет завершатся.",
  ][step];

  return (
    <form ref={formRef} method="post" noValidate onSubmit={onSubmit} className="space-y-5">
      <StepHeader flow="Восстановление" step={step} steps={TITLES.length} title={TITLES[step]} lead={lead} as="h2" />

      {step === EMAIL && (
        <Field id="reset-email" label="E-mail" error={errors.email}>
          <Input
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={FIELD}
            {...describedBy("reset-email", errors.email)}
          />
        </Field>
      )}

      {step === CODE && (
        <CodeCells
          name="reset-code"
          value={code}
          onChange={(v) => {
            setCode(v);
            if (errors.code) setErrors({});
          }}
          onComplete={() => formRef.current?.requestSubmit()}
          error={errors.code}
          resendIn={resendIn}
          onResend={() => void sendCode()}
          onOtherEmail={() => goTo(EMAIL)}
          disabled={pending}
        />
      )}

      {step === PASSWORD && (
        <>
          {/* the address, for the browser to save the new password under it */}
          <input type="hidden" name="username" autoComplete="username" value={sent?.email ?? ""} readOnly />
          <Field id="reset-password" label="Новый пароль" error={errors.password} hint={`Не короче ${PASSWORD_MIN} символов`}>
            <PasswordInput name="new-password" autoComplete="new-password" {...describedBy("reset-password", errors.password, true)} />
          </Field>
        </>
      )}

      {error && <FormError>{error}</FormError>}

      {step === EMAIL ? (
        <Button type="submit" className={SUBMIT} disabled={pending}>
          {pending && <LoaderCircle className="animate-spin" />}
          Получить код
        </Button>
      ) : (
        <div className="flex gap-2">
          {back}
          <Button type="submit" className={cn(SUBMIT, "flex-1")} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" />}
            {step === CODE ? "Далее" : "Сохранить и войти"}
            {step === CODE && !pending && <ArrowRight />}
          </Button>
        </div>
      )}
    </form>
  );
}
