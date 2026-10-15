"use client";

import { ArrowLeft, ArrowRight, Building2, LoaderCircle, PencilLine, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { compact, innError, KPP } from "@/components/account/requisites";
import { SUBMIT, text, useLeaveWhenSignedIn } from "@/components/shop/auth-forms";
import { errorMessage, hasStatus } from "@/components/shop/errors";
import { describedBy, emailError, Field, FIELD, FormError, PASSWORD_MIN, PasswordInput, phoneError, type FieldErrors } from "@/components/shop/form";
import { authHref, nextFromLocation } from "@/components/shop/next-url";
import { useSession } from "@/components/shop/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/** A company from the state registers (GET /api/auth/company, backend/app/companies.py). */
type Company = {
  inn: string;
  kpp: string | null;
  ogrn: string | null;
  name: string;
  full_name: string | null;
  address: string | null;
  manager: string | null;
  sole_trader: boolean;
  status: string;
};
type Lookup = { configured: boolean; available: boolean; company: Company | null; registered: boolean };

const STATUS: Record<string, string> = {
  LIQUIDATING: "в процессе ликвидации",
  LIQUIDATED: "ликвидирована",
  BANKRUPT: "признана банкротом",
  REORGANIZING: "в процессе реорганизации",
};

type Org = { name: string; kpp: string; ogrn: string; address: string };
const NO_ORG: Org = { name: "", kpp: "", ogrn: "", address: "" };

type RegisterField = "inn" | "org" | "kpp" | "name" | "phone" | "email" | "password" | "code";
const STEP_FIELDS: RegisterField[][] = [["inn"], ["org", "kpp"], ["name", "phone"], ["email", "password"], ["code"]];
const CODE_STEP = 4;
const CODE_TTL_MS = 15 * 60_000; // as the backend's CODE_TTL: a code sent earlier is still good

/** The code sent to an address (POST /api/auth/register/code). */
type SentCode = { email: string; at: number; resendAt: number };

/**
 * A client registers with their organization: they become its head, and a manager checks it. Five short steps
 * in the login's card: the ИНН; the organization found by it in the registers to confirm ("Это ваша
 * организация?") or its name and КПП typed by hand; the contact person; the e-mail and password; the code sent to
 * that e-mail. The account is created only with the code: nobody takes an address that is not theirs.
 */
export function RegisterForm() {
  const { register } = useSession();
  const [step, setStep] = useState(0);
  const [inn, setInn] = useState("");
  const [lookup, setLookup] = useState<{ inn: string; result: Lookup | null } | null>(null); // null result: failed
  const [manual, setManual] = useState(false); // the requisites typed by hand even though the company was found
  const [org, setOrg] = useState<Org>(NO_ORG);
  const [errors, setErrors] = useState<FieldErrors<RegisterField>>({});
  const [error, setError] = useState<ReactNode>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<SentCode | null>(null);
  const [now, setNow] = useState(0); // ticks while a resend waits
  const formRef = useRef<HTMLFormElement>(null);
  const focusStep = useRef(false);
  useLeaveWhenSignedIn();

  const innValue = compact(inn);
  const soleTrader = innValue.length === 12;
  const found = lookup?.result?.company ?? null;
  const confirming = step === 1 && !!found && !manual;
  const registered = !!lookup?.result?.registered;
  const titles = ["Организация", confirming ? "Это ваша организация?" : "Реквизиты", "Контактное лицо", "Вход в кабинет", "Код из письма"];
  const resendIn = sent ? Math.max(0, Math.ceil((sent.resendAt - now) / 1000)) : 0;

  // the countdown to another code
  useEffect(() => {
    if (step !== CODE_STEP || !sent) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [step, sent]);

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
    const name = text(data, "name").trim();
    const kpp = soleTrader ? "" : compact(org.kpp);
    const password = text(data, "password");
    return {
      inn: innError(innValue),
      org: org.name.trim().length < 2 ? "Укажите название, как в документах" : org.name.length > 255 ? "Слишком длинное название" : undefined,
      kpp: kpp && !KPP.test(kpp) ? "КПП — 9 символов" : undefined,
      name: !name ? "Укажите, как к вам обращаться" : name.length > 255 ? "Слишком длинное имя" : undefined,
      phone: phoneError(text(data, "phone").trim(), true),
      email: emailError(text(data, "email").trim(), true),
      password:
        password.length < PASSWORD_MIN ? `Пароль должен быть не короче ${PASSWORD_MIN} символов` : password.length > 128 ? "Слишком длинный пароль" : undefined,
      code: /^\d{6}$/.test(text(data, "code").trim()) ? undefined : "Код — 6 цифр из письма",
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

  /** The requisites by ИНН; asked once per ИНН. A failed lookup leaves the form to manual entry. */
  async function findCompany() {
    if (lookup?.inn === innValue) return goTo(1);
    setPending(true);
    let result: Lookup | null = null;
    try {
      result = await api<Lookup>(`/api/auth/company?inn=${innValue}`);
    } catch {
      // too many lookups or no connection: the requisites by hand
    }
    setPending(false);
    setLookup({ inn: innValue, result });
    setManual(false);
    const c = result?.company;
    setOrg(c ? { name: c.name, kpp: c.kpp ?? "", ogrn: c.ogrn ?? "", address: c.address ?? "" } : NO_ORG);
    setErrors({});
    goTo(1);
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
      setNow(at);
      setErrors((prev) => ({ ...prev, code: undefined }));
      const input = formRef.current?.querySelector<HTMLInputElement>('[name="code"]');
      if (input) input.value = "";
      if (step !== CODE_STEP) goTo(CODE_STEP);
      else input?.focus();
    } catch (err) {
      if (hasStatus(err, 409)) {
        setError(alreadyRegistered());
      } else {
        setError(errorMessage(err, "Не удалось отправить код. Попробуйте ещё раз."));
      }
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (step === 0) {
      if (check(0)) await findCompany();
      return;
    }
    if (step === 1) {
      if (registered) return;
      if (confirming || check(1)) goTo(2);
      return;
    }
    if (step === 2) {
      if (check(2)) goTo(3);
      return;
    }
    if (step === 3) {
      if (check(3)) await sendCode();
      return;
    }
    // the last step: everything once more, back to the first step with an error
    for (const s of [CODE_STEP, 3, 2, 1, 0]) {
      if (!check(s)) return s === CODE_STEP ? undefined : goTo(s);
    }
    const data = new FormData(e.currentTarget);
    setPending(true);
    try {
      await register({
        email: text(data, "email").trim(),
        code: text(data, "code").trim(),
        password: text(data, "password"),
        name: text(data, "name").trim(),
        phone: text(data, "phone").trim(),
        organization: {
          name: org.name.trim(),
          inn: innValue,
          kpp: soleTrader ? null : compact(org.kpp) || null,
          ogrn: org.ogrn || null,
          address: org.address || null,
        },
      });
      formRef.current?.reset(); // the page stays in memory for back navigation: no password left in it
    } catch (err) {
      const message = errorMessage(err, "");
      if (hasStatus(err, 409) && message) {
        goTo(1);
        setError(message); // the organization is already a client: its step
      } else if (hasStatus(err, 409)) {
        setError(alreadyRegistered());
      } else if (hasStatus(err, 400) && message) {
        setErrors((prev) => ({ ...prev, code: message })); // a wrong or expired code
        formRef.current?.querySelector<HTMLInputElement>('[name="code"]')?.select();
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
      <div>
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-semibold">{titles[step]}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            Шаг {step + 1} из {titles.length}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-5 gap-1.5" aria-hidden>
          {titles.map((t, i) => (
            <span key={i} className={cn("h-1 rounded-full transition-colors duration-300", i <= step ? "bg-primary" : "bg-muted")} />
          ))}
        </div>
      </div>

      {/* 1. ИНН */}
      <fieldset hidden={step !== 0} className="space-y-4">
        <legend className="sr-only">ИНН организации</legend>
        <Field id="reg-inn" label="ИНН" error={errors.inn} hint="10 цифр у организации, 12 у ИП. Название, КПП и адрес подставим сами">
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
      </fieldset>

      {/* 2. the organization found by the ИНН, or its requisites by hand */}
      {step === 1 && confirming && found && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-muted/50 p-4 ring-1 ring-foreground/5">
            <div className="flex gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-background text-primary ring-1 ring-foreground/10">
                <Building2 className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold leading-snug break-words">{found.name}</p>
                <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                  ИНН {found.inn}
                  {found.kpp && ` · КПП ${found.kpp}`}
                </p>
              </div>
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              {found.ogrn && <Row label={found.sole_trader ? "ОГРНИП" : "ОГРН"}>{found.ogrn}</Row>}
              {found.manager && <Row label="Руководитель">{found.manager}</Row>}
              {found.address && <Row label="Адрес">{found.address}</Row>}
            </dl>
          </div>
          {STATUS[found.status] && (
            <p className="flex gap-2 text-sm text-amber-700">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              По данным ЕГРЮЛ организация {STATUS[found.status]}.
            </p>
          )}
          {!registered && (
            <button type="button" onClick={() => setManual(true)} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <PencilLine className="size-3.5" />
              Реквизиты отличаются — поправить вручную
            </button>
          )}
        </div>
      )}
      <fieldset hidden={step !== 1 || confirming} className="space-y-4">
        <legend className="sr-only">Реквизиты организации</legend>
        {step === 1 && !confirming && lookup && <ManualNote lookup={lookup.result} edited={manual} />}
        <Field id="reg-org" label="Название" error={errors.org} hint="Как в документах: ООО «Ромашка», ИП Иванов И. И.">
          <Input
            name="org"
            autoComplete="organization"
            maxLength={255}
            value={org.name}
            onChange={(e) => setOrg({ ...org, name: e.target.value })}
            className={FIELD}
            {...describedBy("reg-org", errors.org, true)}
          />
        </Field>
        {!soleTrader && (
          <Field id="reg-kpp" label="КПП" optional error={errors.kpp}>
            <Input
              name="kpp"
              autoComplete="off"
              maxLength={12}
              value={org.kpp}
              onChange={(e) => setOrg({ ...org, kpp: e.target.value })}
              className={`${FIELD} tabular-nums`}
              {...describedBy("reg-kpp", errors.kpp)}
            />
          </Field>
        )}
      </fieldset>
      {step === 1 && registered && (
        <FormError>
          Организация с этим ИНН уже работает с нами. Попросите её руководителя добавить вас в сотрудники в кабинете или напишите нам.
        </FormError>
      )}

      {/* 3. the contact person */}
      <fieldset hidden={step !== 2} className="space-y-4">
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
      </fieldset>

      {/* 4. the login */}
      <fieldset hidden={step !== 3} className="space-y-4">
        <legend className="sr-only">Вход в кабинет</legend>
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

      {/* 5. the code sent to the e-mail */}
      <fieldset hidden={step !== CODE_STEP} className="space-y-4">
        <legend className="sr-only">Код из письма</legend>
        <p className="text-sm text-muted-foreground">
          Мы отправили код на <span className="font-medium text-foreground">{sent?.email}</span>. Письмо приходит за минуту; если его нет,
          загляните в «Спам».
        </p>
        <Field id="reg-code" label="Код из письма" error={errors.code}>
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="••••••"
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
              e.target.value = digits;
              if (errors.code) setErrors((prev) => ({ ...prev, code: undefined }));
              // all six typed or pasted: on at once
              if (digits.length === 6 && !pending) formRef.current?.requestSubmit();
            }}
            className={`${FIELD} text-center text-xl font-semibold tracking-[0.5em] tabular-nums placeholder:tracking-[0.3em]`}
            {...describedBy("reg-code", errors.code)}
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button type="button" onClick={() => goTo(3)} className="text-muted-foreground hover:text-foreground">
            Изменить e-mail
          </button>
          <button
            type="button"
            disabled={resendIn > 0 || pending}
            onClick={() => void sendCode(true)}
            className="font-medium text-primary hover:underline disabled:font-normal disabled:text-muted-foreground disabled:no-underline"
          >
            {resendIn > 0 ? `Отправить снова через ${resendIn} с` : "Отправить код снова"}
          </button>
        </div>
      </fieldset>

      {error && <FormError>{error}</FormError>}

      {step === 0 && (
        <Button type="submit" className={SUBMIT} disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : null}
          {pending ? "Ищем организацию…" : "Далее"}
          {!pending && <ArrowRight />}
        </Button>
      )}
      {step === 1 && confirming && (
        <div className="space-y-2">
          <Button type="submit" className={SUBMIT} disabled={registered}>
            Да, это наша организация
          </Button>
          <Button type="button" variant="ghost" className="h-10 w-full rounded-xl text-muted-foreground" onClick={() => goTo(0)}>
            Нет — изменить ИНН
          </Button>
        </div>
      )}
      {((step === 1 && !confirming) || step === 2) && (
        <div className="flex gap-2">
          {back}
          <Button type="submit" className={cn(SUBMIT, "flex-1")} disabled={step === 1 && registered}>
            Далее
            <ArrowRight />
          </Button>
        </div>
      )}
      {step === 3 && (
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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

/** Why the requisites are typed by hand: not found, the lookup failed, or the found ones are being corrected. */
function ManualNote({ lookup, edited }: { lookup: Lookup | null; edited: boolean }) {
  if (edited) return <p className="text-sm text-muted-foreground">Поправьте реквизиты, как в ваших документах.</p>;
  if (lookup && !lookup.configured) return null; // no lookup on this site: nothing to explain
  return (
    <p className="text-sm text-muted-foreground">
      {lookup?.available
        ? "В ЕГРЮЛ организации с таким ИНН не нашлось. Проверьте ИНН или заполните реквизиты вручную."
        : "Не удалось получить данные из ЕГРЮЛ — заполните реквизиты вручную."}
    </p>
  );
}
