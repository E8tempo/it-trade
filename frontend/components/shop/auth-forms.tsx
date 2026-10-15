"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

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
const REGISTER_FIELDS: RegisterField[] = ["inn", "org", "kpp", "name", "phone", "email", "password"];

/** A client registers with their organization: they become its head, and a manager checks it. */
export function RegisterForm() {
  const { register } = useSession();
  const [errors, setErrors] = useState<FieldErrors<RegisterField>>({});
  const [error, setError] = useState<ReactNode>(null);
  const [pending, setPending] = useState(false);
  const [inn, setInn] = useState("");
  const soleTrader = compact(inn).length === 12;
  useLeaveWhenSignedIn();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const values = {
      inn: compact(text(data, "inn")),
      org: text(data, "org").trim(),
      kpp: soleTrader ? "" : compact(text(data, "kpp")),
      name: text(data, "name").trim(),
      email: text(data, "email").trim(),
      phone: text(data, "phone").trim(),
      password: text(data, "password"),
    };
    const found: FieldErrors<RegisterField> = {
      inn: innError(values.inn),
      org: values.org.length < 2 ? "Укажите название, как в документах" : values.org.length > 255 ? "Слишком длинное название" : undefined,
      kpp: values.kpp && !KPP.test(values.kpp) ? "КПП — 9 символов" : undefined,
      name: !values.name ? "Укажите, как к вам обращаться" : values.name.length > 255 ? "Слишком длинное имя" : undefined,
      email: emailError(values.email, true),
      phone: phoneError(values.phone, true),
      password:
        values.password.length < PASSWORD_MIN
          ? `Пароль должен быть не короче ${PASSWORD_MIN} символов`
          : values.password.length > 128
            ? "Слишком длинный пароль"
            : undefined,
    };
    const invalid = REGISTER_FIELDS.filter((k) => found[k]);
    setErrors(found);
    setError(null);
    if (invalid.length) {
      form.querySelector<HTMLInputElement>(`[name="${invalid[0]}"]`)?.focus();
      return;
    }
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
        setError(message); // the organization is already a client
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
    <form method="post" noValidate onSubmit={onSubmit} className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-semibold">Организация</legend>
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
      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-semibold">Контактное лицо</legend>
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
      {error && (
        <div className="md:col-span-2">
          <FormError>{error}</FormError>
        </div>
      )}
      <Button type="submit" className={cn(SUBMIT, "md:col-span-2")} disabled={pending}>
        {pending && <LoaderCircle className="animate-spin" />}
        Зарегистрировать организацию
      </Button>
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
