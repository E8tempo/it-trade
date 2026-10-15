"use client";

import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { CodeCells, SentTo, StepHeader, useCountdown } from "@/components/shop/code-steps";
import { errorMessage, hasStatus } from "@/components/shop/errors";
import { describedBy, emailError, Field, FIELD, FormError, PASSWORD_MIN, PasswordInput, SUBMIT } from "@/components/shop/form";
import { useSession } from "@/components/shop/session-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const EMAIL = 0;
const CODE = 1;
const PASSWORD = 2;

type Errors = { email?: string; code?: string; password?: string; repeat?: string };

/**
 * A new password with a code sent to the e-mail, in steps like the registration's.
 * - «Забыли пароль?» on the login page: the e-mail, the code (checked at once), the new password; then the client
 *   is signed in, and the login page takes them on.
 * - From the account (`account`): the code goes to the user's own e-mail at once; the code, the new password. This
 *   session stays, the others end. No current password: a forgotten one is no obstacle, the e-mail proves it is them.
 */
export function ResetPasswordDialog({
  open,
  onOpenChange,
  initialEmail,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialEmail: string;
  account?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-3xl p-6 sm:max-w-[27rem] sm:p-8">
        <DialogTitle className="sr-only">{account ? "Смена пароля" : "Восстановление пароля"}</DialogTitle>
        {/* mounted while open: every time from the first step */}
        <ResetForm initialEmail={initialEmail} account={!!account} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ResetForm({ initialEmail, account, onDone }: { initialEmail: string; account: boolean; onDone: () => void }) {
  const { login, changePassword } = useSession();
  // from the account the address is known: no e-mail step
  const [step, setStep] = useState(account ? CODE : EMAIL);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<{ email: string; resendAt: number } | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const resendIn = useCountdown(sent?.resendAt ?? null, step === CODE);
  const first = account ? CODE : EMAIL;
  const titles = account ? ["Подтвердите почту", "Новый пароль"] : ["Восстановление пароля", "Подтвердите почту", "Новый пароль"];

  // from the account: the code goes out as the dialog opens
  const asked = useRef(false);
  useEffect(() => {
    if (!account || asked.current) return;
    asked.current = true;
    void sendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on opening
  }, []);

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
      if (step !== CODE) goTo(CODE);
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
    const data = new FormData(form);
    const password = String(data.get("new-password") ?? "");
    const found: Errors = {
      password:
        password.length < PASSWORD_MIN ? `Пароль должен быть не короче ${PASSWORD_MIN} символов` : password.length > 128 ? "Слишком длинный пароль" : undefined,
    };
    found.repeat = !found.password && String(data.get("repeat-password") ?? "") !== password ? "Пароли не совпадают" : undefined;
    setErrors(found);
    if (found.password || found.repeat || !sent) return;
    setPending(true);
    setError(null);
    try {
      if (account) {
        await changePassword(code, password); // this session stays, the others end
        toast.success("Пароль изменён. На других устройствах нужно войти заново.");
      } else {
        await api("/api/auth/password/reset", { method: "POST", body: JSON.stringify({ email: sent.email, code, new_password: password }) });
        await login(sent.email, password); // the login page then takes the client on
      }
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
    sent ? <SentTo key="sent" email={sent.email} /> : pending ? "Отправляем код на вашу почту…" : null,
    account ? "На других устройствах нужно будет войти заново." : "Остальные входы в кабинет завершатся.",
  ][step];

  return (
    <form ref={formRef} method="post" noValidate onSubmit={onSubmit} className="space-y-5">
      <StepHeader
        flow={account ? "Смена пароля" : "Восстановление"}
        step={step - first}
        steps={titles.length}
        title={titles[step - first]}
        lead={lead}
        as="h2"
      />

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
          onOtherEmail={account ? undefined : () => goTo(EMAIL)}
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
          <Field id="reset-repeat" label="Повторите пароль" error={errors.repeat}>
            <PasswordInput name="repeat-password" autoComplete="new-password" {...describedBy("reset-repeat", errors.repeat)} />
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
          {step > first && back}
          <Button type="submit" className={cn(SUBMIT, "flex-1")} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" />}
            {step === CODE ? "Далее" : account ? "Сохранить пароль" : "Сохранить и войти"}
            {step === CODE && !pending && <ArrowRight />}
          </Button>
        </div>
      )}
    </form>
  );
}
