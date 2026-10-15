"use client";

import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { text, useLeaveWhenSignedIn } from "@/components/shop/auth-forms";
import { CodeCells, SentTo, StepHeader, useCountdown } from "@/components/shop/code-steps";
import { errorMessage, hasStatus } from "@/components/shop/errors";
import { describedBy, emailError, Field, FIELD, FormError, PASSWORD_MIN, PasswordInput, phoneError, SUBMIT, type FieldErrors } from "@/components/shop/form";
import { authHref, nextFromLocation } from "@/components/shop/next-url";
import { useSession } from "@/components/shop/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type RegisterField = "name" | "last_name" | "phone" | "email" | "password" | "repeat" | "code";
const STEP_FIELDS: RegisterField[][] = [["name", "last_name", "phone"], ["email", "password", "repeat"], ["code"]];
const CODE_STEP = 2;
const TITLES = ["Как вас зовут", "Вход в кабинет", "Подтвердите почту"];
// under each step's heading (the code step names the address instead)
const LEADS = ["Организацию можно добавить потом в кабинете — по ИНН.", "E-mail станет логином, на него придёт код.", null];
const CODE_TTL_MS = 15 * 60_000; // as the backend's CODE_TTL: a code sent earlier is still good

/** The code sent to an address (POST /api/auth/register/code). */
type SentCode = { email: string; at: number; resendAt: number };

function nameError(value: string, what: string): string | undefined {
  return !value ? `Укажите ${what}` : value.length > 255 ? "Слишком длинно" : undefined;
}

/**
 * A client registers as a private person and buys as one right away; organizations are added later in the account
 * (by ИНН, checked by a manager). Three short steps in the login's card: the name, last name and phone; the e-mail and
 * password; the code sent to that e-mail. The account is created only with the code: nobody takes an address that is
 * not theirs.
 */
export function RegisterForm() {
  const { register } = useSession();
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldErrors<RegisterField>>({});
  const [error, setError] = useState<ReactNode>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<SentCode | null>(null);
  const [code, setCode] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const focusStep = useRef(false);
  useLeaveWhenSignedIn();

  const resendIn = useCountdown(sent?.resendAt ?? null, step === CODE_STEP);

  // the first field of a step that just opened (or its first error)
  useEffect(() => {
    if (!focusStep.current) return;
    focusStep.current = false;
    const first = STEP_FIELDS[step].find((k) => errors[k]) ?? STEP_FIELDS[step][0];
    formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
  }, [step, errors]);

  function goTo(next: number) {
    focusStep.current = true;
    setError(null);
    setStep(next);
  }

  function fieldErrors(): FieldErrors<RegisterField> {
    const data = new FormData(formRef.current!);
    const password = text(data, "password");
    return {
      name: nameError(text(data, "name").trim(), "имя"),
      last_name: nameError(text(data, "last_name").trim(), "фамилию"),
      phone: phoneError(text(data, "phone").trim(), true),
      email: emailError(text(data, "email").trim(), true),
      password:
        password.length < PASSWORD_MIN ? `Пароль должен быть не короче ${PASSWORD_MIN} символов` : password.length > 128 ? "Слишком длинный пароль" : undefined,
      repeat: password.length >= PASSWORD_MIN && text(data, "repeat") !== password ? "Пароли не совпадают" : undefined,
      code: /^\d{6}$/.test(code) ? undefined : "Введите 6 цифр из письма",
    };
  }

  /** Shows the errors of a step's fields; true if there are none. */
  function check(s: number): boolean {
    const all = fieldErrors();
    const shown = Object.fromEntries(STEP_FIELDS[s].map((k) => [k, all[k]]));
    setErrors((prev) => ({ ...prev, ...shown }));
    const bad = STEP_FIELDS[s].find((k) => all[k]);
    if (bad) formRef.current?.querySelector<HTMLInputElement>(`[name="${bad}"]`)?.focus();
    return !bad;
  }

  /** Sends the code to the e-mail typed (again only when asked, or for another address) and opens its step. */
  async function sendCode(force = false) {
    const email = text(new FormData(formRef.current!), "email").trim().toLowerCase();
    if (!force && sent?.email === email && Date.now() - sent.at < CODE_TTL_MS) return goTo(CODE_STEP);
    setPending(true);
    setError(null);
    try {
      const r = await api<{ email: string; resend_in: number }>("/api/auth/register/code", { method: "POST", body: JSON.stringify({ email }) });
      const at = Date.now();
      setSent({ email: r.email, at, resendAt: at + r.resend_in * 1000 });
      setErrors((prev) => ({ ...prev, code: undefined }));
      setCode("");
      if (step !== CODE_STEP) goTo(CODE_STEP);
      else formRef.current?.querySelector<HTMLInputElement>('[name="code"]')?.focus();
    } catch (err) {
      // a registered address gets the same answer (and a letter saying so), not an error
      setError(errorMessage(err, "Не удалось отправить код. Попробуйте ещё раз."));
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (step === 0) {
      if (check(0)) goTo(1);
      return;
    }
    if (step === 1) {
      if (check(1)) await sendCode();
      return;
    }
    // the last step: everything once more, back to the first step with an error
    for (const s of [CODE_STEP, 1, 0]) {
      if (!check(s)) return s === CODE_STEP ? undefined : goTo(s);
    }
    const data = new FormData(e.currentTarget);
    setPending(true);
    try {
      await register({
        email: text(data, "email").trim(),
        code,
        password: text(data, "password"),
        name: text(data, "name").trim(),
        last_name: text(data, "last_name").trim(),
        phone: text(data, "phone").trim(),
      });
      formRef.current?.reset(); // the page stays in memory for back navigation: no password left in it
    } catch (err) {
      const message = errorMessage(err, "");
      if (hasStatus(err, 409)) {
        setError(alreadyRegistered());
      } else if (hasStatus(err, 400) && message) {
        setErrors((prev) => ({ ...prev, code: message })); // a wrong or expired code
        setCode("");
        formRef.current?.querySelector<HTMLInputElement>('[name="code"]')?.focus();
      } else if (hasStatus(err, 422)) {
        setError(message || "Проверьте данные: сервер их не принял.");
      } else {
        setError(errorMessage(err, "Не удалось зарегистрироваться. Попробуйте ещё раз."));
      }
    } finally {
      setPending(false);
    }
  }

  const back = (
    <Button type="button" variant="outline" className="h-11 rounded-xl px-4" onClick={() => goTo(step - 1)} disabled={pending} aria-label="Назад">
      <ArrowLeft />
    </Button>
  );

  return (
    <form ref={formRef} method="post" noValidate onSubmit={onSubmit} className="space-y-5">
      <StepHeader
        flow="Регистрация"
        step={step}
        steps={TITLES.length}
        title={TITLES[step]}
        lead={step === CODE_STEP && sent ? <SentTo email={sent.email} /> : LEADS[step]}
      />

      {/* 1. who */}
      <fieldset hidden={step !== 0} className="space-y-4">
        <legend className="sr-only">Как вас зовут</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="reg-name" label="Имя" error={errors.name}>
            <Input name="name" autoComplete="given-name" maxLength={255} className={FIELD} {...describedBy("reg-name", errors.name)} />
          </Field>
          <Field id="reg-last-name" label="Фамилия" error={errors.last_name}>
            <Input name="last_name" autoComplete="family-name" maxLength={255} className={FIELD} {...describedBy("reg-last-name", errors.last_name)} />
          </Field>
        </div>
        <Field id="reg-phone" label="Телефон" error={errors.phone}>
          <Input
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+7 978 123-45-67"
            maxLength={32}
            className={FIELD}
            {...describedBy("reg-phone", errors.phone, true)}
          />
        </Field>
      </fieldset>

      {/* 2. the login */}
      <fieldset hidden={step !== 1} className="space-y-4">
        <legend className="sr-only">Вход в кабинет</legend>
        <Field id="reg-email" label="E-mail" error={errors.email}>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            className={FIELD}
            {...describedBy("reg-email", errors.email, true)}
          />
        </Field>
        <Field id="reg-password" label="Пароль" error={errors.password} hint={`Не короче ${PASSWORD_MIN} символов`}>
          <PasswordInput name="password" autoComplete="new-password" required {...describedBy("reg-password", errors.password, true)} />
        </Field>
        <Field id="reg-repeat" label="Повторите пароль" error={errors.repeat}>
          <PasswordInput name="repeat" autoComplete="new-password" required {...describedBy("reg-repeat", errors.repeat)} />
        </Field>
      </fieldset>

      {/* 3. the code sent to the e-mail */}
      <fieldset hidden={step !== CODE_STEP}>
        <legend className="sr-only">Код из письма</legend>
        <CodeCells
          name="code"
          value={code}
          onChange={(v) => {
            setCode(v);
            if (errors.code) setErrors((prev) => ({ ...prev, code: undefined }));
          }}
          onComplete={() => formRef.current?.requestSubmit()}
          error={errors.code}
          resendIn={resendIn}
          onResend={() => void sendCode(true)}
          onOtherEmail={() => goTo(1)}
          disabled={pending}
        />
      </fieldset>

      {error && <FormError>{error}</FormError>}

      {step === 0 && (
        <Button type="submit" className={SUBMIT}>
          Далее
          <ArrowRight />
        </Button>
      )}
      {step === 1 && (
        <div className="flex gap-2">
          {back}
          <Button type="submit" className={cn(SUBMIT, "flex-1")} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" />}
            Получить код
          </Button>
        </div>
      )}
      {step === CODE_STEP && (
        <div className="flex gap-2">
          {back}
          <Button type="submit" className={cn(SUBMIT, "flex-1")} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" />}
            Зарегистрироваться
          </Button>
        </div>
      )}
    </form>
  );
}

/** «Этот e-mail уже зарегистрирован. Войти», keeping ?next=. */
function alreadyRegistered(): ReactNode {
  const next = nextFromLocation("");
  return (
    <>
      Этот e-mail уже зарегистрирован.{" "}
      <Link href={authHref("/login", next || null)} className="font-medium underline underline-offset-2">
        Войти
      </Link>
    </>
  );
}
