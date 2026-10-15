"use client";

import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { errorMessage, hasStatus } from "@/components/shop/errors";
import {
  describedBy,
  emailError,
  Field,
  FIELD,
  FormError,
  PASSWORD_MIN,
  PasswordInput,
  phoneError,
  type FieldErrors,
} from "@/components/shop/form";
import { compact, innError, KPP } from "@/components/account/requisites";
import { authHref, nextFromLocation, safeNext } from "@/components/shop/next-url";
import { useSession } from "@/components/shop/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const SUBMIT = "h-11 w-full gap-2 rounded-xl text-[15px]";

/** Signed in (already, or just now): on to ?next=, by default the account. */
function useLeaveWhenSignedIn() {
  const router = useRouter();
  const { user, loading } = useSession();
  useEffect(() => {
    if (!loading && user) router.replace(nextFromLocation());
  }, [loading, user, router]);
}

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "");
}

export function LoginForm() {
  const { login } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useLeaveWhenSignedIn();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const email = text(data, "email").trim();
    const password = text(data, "password");
    if (!email || !password) {
      setError("Введите e-mail и пароль.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await login(email, password);
      form.reset(); // the page stays in memory for back navigation: no password left in it
    } catch (err) {
      setError(
        hasStatus(err, 401, 422)
          ? "Неверный e-mail или пароль."
          : hasStatus(err, 429)
            ? "Слишком много попыток. Попробуйте через 15 минут."
            : errorMessage(err, "Не удалось войти. Попробуйте ещё раз."),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    // method="post": if the page's JS fails to load, the browser must not put the password in the URL
    <form method="post" noValidate onSubmit={onSubmit} className="space-y-4">
      <Field id="login-email" label="E-mail">
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          className={FIELD}
        />
      </Field>
      <Field id="login-password" label="Пароль">
        <PasswordInput id="login-password" name="password" autoComplete="current-password" required />
      </Field>
      {error && <FormError>{error}</FormError>}
      <Button type="submit" className={SUBMIT} disabled={pending}>
        {pending && <LoaderCircle className="animate-spin" />}
        Войти
      </Button>
    </form>
  );
}

type RegisterField = "inn" | "org" | "kpp" | "name" | "email" | "phone" | "password";
// the two steps of the form, in the order of their fields
const STEPS: { title: string; fields: RegisterField[] }[] = [
  { title: "Организация", fields: ["inn", "org", "kpp"] },
  { title: "Контактное лицо", fields: ["name", "phone", "email", "password"] },
];

type RegisterValues = Record<RegisterField, string>;

function registerValues(form: HTMLFormElement, soleTrader: boolean): RegisterValues {
  const data = new FormData(form); // the hidden step's inputs are in it too
  return {
    inn: compact(text(data, "inn")),
    org: text(data, "org").trim(),
    kpp: soleTrader ? "" : compact(text(data, "kpp")),
    name: text(data, "name").trim(),
    email: text(data, "email").trim(),
    phone: text(data, "phone").trim(),
    password: text(data, "password"),
  };
}

function registerErrors(v: RegisterValues): FieldErrors<RegisterField> {
  return {
    inn: innError(v.inn),
    org: v.org.length < 2 ? "Укажите название, как в документах" : v.org.length > 255 ? "Слишком длинное название" : undefined,
    kpp: v.kpp && !KPP.test(v.kpp) ? "КПП — 9 символов" : undefined,
    name: !v.name ? "Укажите, как к вам обращаться" : v.name.length > 255 ? "Слишком длинное имя" : undefined,
    email: emailError(v.email, true),
    phone: phoneError(v.phone, true),
    password:
      v.password.length < PASSWORD_MIN
        ? `Пароль должен быть не короче ${PASSWORD_MIN} символов`
        : v.password.length > 128
          ? "Слишком длинный пароль"
          : undefined,
  };
}

/**
 * A client registers with their organization: they become its head, and a manager checks it. Two steps in the
 * login's narrow card — the organization, then the contact person — so switching from login is not a jump.
 */
export function RegisterForm() {
  const { register } = useSession();
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldErrors<RegisterField>>({});
  const [error, setError] = useState<ReactNode>(null);
  const [pending, setPending] = useState(false);
  const [inn, setInn] = useState("");
  const soleTrader = compact(inn).length === 12;
  const formRef = useRef<HTMLFormElement>(null);
  const focusOnStep = useRef(false); // set when the step changes by a click, not on the first render
  useLeaveWhenSignedIn();

  // the first field of a step that just opened (or its first error)
  useEffect(() => {
    if (!focusOnStep.current) return;
    focusOnStep.current = false;
    const first = STEPS[step].fields.find((k) => errors[k]) ?? STEPS[step].fields[0];
    formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
  }, [step, errors]);

  function goTo(next: number) {
    focusOnStep.current = true;
    setStep(next);
  }

  /** Checks the fields of a step; true if they are fine. */
  function check(stepFields: RegisterField[], values: RegisterValues): boolean {
    const found = registerErrors(values);
    const shown = Object.fromEntries(stepFields.map((k) => [k, found[k]])) as FieldErrors<RegisterField>;
    setErrors((prev) => ({ ...prev, ...shown }));
    const bad = stepFields.find((k) => found[k]);
    if (bad) formRef.current?.querySelector<HTMLInputElement>(`[name="${bad}"]`)?.focus();
    return !bad;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = registerValues(form, soleTrader);
    setError(null);
    if (step === 0) {
      // Enter or «Далее» on the first step: on to the second
      if (check(STEPS[0].fields, values)) goTo(1);
      return;
    }
    if (!check(STEPS[1].fields, values)) return;
    if (!check(STEPS[0].fields, values)) return goTo(0);
    setPending(true);
    try {
      await register({
        email: values.email,
        password: values.password,
        name: values.name,
        phone: values.phone,
        organization: { name: values.org, inn: values.inn, kpp: values.kpp || null, ogrn: null, address: null },
      });
      form.reset();
    } catch (err) {
      const message = errorMessage(err, "");
      if (hasStatus(err, 409) && message) {
        setError(message); // the organization is already a client: its step
        goTo(0);
      } else if (hasStatus(err, 409)) {
        const next = nextFromLocation("");
        setError(
          <>
            Этот e-mail уже зарегистрирован.{" "}
            <Link href={authHref("/login", next || null)} className="font-medium underline underline-offset-2">
              Войти
            </Link>
          </>,
        );
      } else if (hasStatus(err, 422)) {
        setError(message || "Проверьте данные: сервер их не принял.");
      } else {
        setError(errorMessage(err, "Не удалось зарегистрироваться. Попробуйте ещё раз."));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} method="post" noValidate onSubmit={onSubmit} className="space-y-5">
      <div>
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold">{STEPS[step].title}</span>
          <span className="text-muted-foreground tabular-nums">
            Шаг {step + 1} из {STEPS.length}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5" aria-hidden>
          {STEPS.map((st, i) => (
            <span key={st.title} className={cn("h-1 rounded-full transition-colors duration-300", i <= step ? "bg-primary" : "bg-muted")} />
          ))}
        </div>
      </div>

      <fieldset hidden={step !== 0} className="space-y-4">
        <legend className="sr-only">Организация</legend>
        <Field id="reg-inn" label="ИНН" error={errors.inn} hint="10 цифр у организации, 12 у ИП">
          <Input
            name="inn"
            inputMode="numeric"
            autoComplete="off"
            maxLength={16}
            value={inn}
            onChange={(e) => setInn(e.target.value)}
            className={`${FIELD} tabular-nums`}
            {...describedBy("reg-inn", errors.inn, true)}
          />
        </Field>
        <Field id="reg-org" label="Название" error={errors.org} hint="Как в документах: ООО «Ромашка», ИП Иванов И. И.">
          <Input name="org" autoComplete="organization" maxLength={255} className={FIELD} {...describedBy("reg-org", errors.org, true)} />
        </Field>
        {!soleTrader && (
          <Field id="reg-kpp" label="КПП" optional error={errors.kpp}>
            <Input name="kpp" autoComplete="off" maxLength={12} className={`${FIELD} tabular-nums`} {...describedBy("reg-kpp", errors.kpp)} />
          </Field>
        )}
      </fieldset>

      <fieldset hidden={step !== 1} className="space-y-4">
        <legend className="sr-only">Контактное лицо</legend>
        <Field id="reg-name" label="Имя" error={errors.name}>
          <Input name="name" autoComplete="name" maxLength={255} className={FIELD} {...describedBy("reg-name", errors.name)} />
        </Field>
        <Field id="reg-phone" label="Телефон" error={errors.phone} hint="По нему менеджер подтвердит организацию">
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
        <Field id="reg-email" label="E-mail" error={errors.email} hint="Логин для входа">
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
      </fieldset>

      {error && <FormError>{error}</FormError>}
      {step === 0 ? (
        <Button type="submit" className={SUBMIT}>
          Далее
          <ArrowRight />
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-11 rounded-xl px-4" onClick={() => goTo(0)} disabled={pending} aria-label="Назад">
            <ArrowLeft />
          </Button>
          <Button type="submit" className={cn(SUBMIT, "flex-1")} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" />}
            Зарегистрироваться
          </Button>
        </div>
      )}
    </form>
  );
}

/** «Зарегистрируйтесь» / «Войти» under a form, keeping ?next=. Reads the URL: render inside <Suspense>. */
export function AuthSwitchLink({ to, children }: { to: "/login" | "/register"; children: ReactNode }) {
  const next = safeNext(useSearchParams().get("next"), "");
  return (
    <Link href={authHref(to, next || null)} className="font-medium text-primary hover:underline">
      {children}
    </Link>
  );
}

/** «Вход | Регистрация» at the top of the card, keeping ?next=. Reads the URL: render inside <Suspense>. */
export function AuthTabs({ active }: { active: "/login" | "/register" }) {
  const next = safeNext(useSearchParams().get("next"), "");
  const tabs = [
    ["/login", "Вход"],
    ["/register", "Регистрация"],
  ] as const;
  return (
    <nav className="grid grid-cols-2 rounded-xl bg-muted p-1 text-sm font-medium" aria-label="Вход или регистрация">
      {tabs.map(([href, label]) => (
        <Link
          key={href}
          href={authHref(href, next || null)}
          aria-current={href === active ? "page" : undefined}
          className={cn(
            "rounded-lg px-3 py-2 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            href === active ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
