"use client";

import { ArrowLeft, Building2, LoaderCircle, PencilLine, Search, TriangleAlert } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { compact, innError } from "@/components/account/requisites";
import {
  NO_REQUISITES,
  REQUISITES_KEYS,
  RequisitesFields,
  requisitesBody,
  requisitesErrors,
  type Requisites,
  type RequisitesKey,
} from "@/components/account/requisites-form";
import { errorMessage, hasStatus } from "@/components/shop/errors";
import { describedBy, Field, FIELD, FormError, type FieldErrors } from "@/components/shop/form";
import { useSession } from "@/components/shop/session-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import type { Organization } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A company from the state registers (GET /api/account/company, backend/app/companies.py). */
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
/** `registered`: a client of ours already; `mine`: in this user's account already. */
type Lookup = { configured: boolean; available: boolean; company: Company | null; registered: boolean; mine: boolean };

const STATUS: Record<string, string> = {
  LIQUIDATING: "в процессе ликвидации",
  LIQUIDATED: "ликвидирована",
  BANKRUPT: "признана банкротом",
  REORGANIZING: "в процессе реорганизации",
};

const REGISTERED = "Организация с этим ИНН уже работает с нами. Попросите её руководителя добавить вас в сотрудники или напишите нам.";
const MINE = "Эта организация уже есть в вашем кабинете.";

const DIALOG = "gap-5 p-5 sm:max-w-lg sm:p-6";
const DIALOG_FOOT = "-mx-5 -mb-5 rounded-b-xl px-5 sm:-mx-6 sm:-mb-6 sm:px-6";

type Step = "inn" | "confirm" | "manual";

function fromCompany(c: Company): Requisites {
  return { name: c.name, inn: c.inn, kpp: c.kpp ?? "", ogrn: c.ogrn ?? "", address: c.address ?? "" };
}

/**
 * Adding an organization the way registration used to: the ИНН first, then the company found by it in the registers
 * to confirm («Это ваша организация?»), or its requisites typed by hand when it is not found, the lookup failed or the
 * found ones differ. The user becomes its head; a manager checks it, and from then on the user buys for it.
 */
export function AddOrganizationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { keepSession, refreshOrganizations } = useSession();
  const [step, setStep] = useState<Step>("inn");
  const [inn, setInn] = useState("");
  const [lookup, setLookup] = useState<{ inn: string; result: Lookup | null } | null>(null); // null result: failed
  const [values, setValues] = useState<Requisites>(NO_REQUISITES);
  const [edited, setEdited] = useState(false); // the found requisites are being corrected
  const [errors, setErrors] = useState<FieldErrors<RequisitesKey>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // every opening starts afresh
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep("inn");
      setInn("");
      setLookup(null);
      setValues(NO_REQUISITES);
      setEdited(false);
      setErrors({});
      setError(null);
    }
  }

  const innValue = compact(inn);
  const result = lookup?.result ?? null;
  const found = result?.company ?? null;
  const refused = result?.mine ? MINE : result?.registered ? REGISTERED : null;

  const go = (next: Step) => {
    setError(null);
    setStep(next);
    // the first field of the step that opened
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>("input:not([type=hidden])")?.focus());
  };

  /** The company by ИНН, asked once per ИНН; a failed lookup leaves the requisites to be typed by hand. */
  async function find() {
    const bad = innError(innValue);
    setErrors({ inn: bad });
    if (bad) return;
    let r: Lookup | null = lookup?.inn === innValue ? lookup.result : null;
    if (lookup?.inn !== innValue) {
      setPending(true);
      try {
        await keepSession();
        r = await api<Lookup>(`/api/account/company?inn=${innValue}`);
      } catch {
        r = null; // too many lookups or no connection: the requisites by hand
      }
      setPending(false);
      setLookup({ inn: innValue, result: r });
      setEdited(false);
      setValues(r?.company ? fromCompany(r.company) : { ...NO_REQUISITES, inn: innValue });
    }
    if (r?.mine) return setErrors({ inn: MINE });
    go(r?.company ? "confirm" : "manual");
  }

  async function save(body: Requisites) {
    setPending(true);
    setError(null);
    try {
      await keepSession();
      await api<Organization>("/api/account/organizations", { method: "POST", body: JSON.stringify(requisitesBody(body)) });
      await refreshOrganizations().catch(() => undefined);
      toast.success("Организация отправлена на проверку", {
        description: "Когда менеджер её подтвердит, цены и заказы переключатся на неё.",
      });
      onOpenChange(false);
    } catch (err) {
      const message = errorMessage(err, "Не удалось добавить организацию. Попробуйте ещё раз.");
      setError(message);
      if (hasStatus(err, 409) && step === "manual") setErrors({ inn: message });
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (step === "inn") return void find();
    if (step === "confirm") return refused ? undefined : void save(values);
    const bad = requisitesErrors(values);
    setErrors(bad);
    const first = REQUISITES_KEYS.find((k) => bad[k]);
    if (first) return formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
    void save(values);
  }

  const title = step === "inn" ? "Новая организация" : step === "confirm" ? "Это ваша организация?" : "Реквизиты организации";
  const lead =
    step === "inn"
      ? "Укажите ИНН — найдём организацию и подставим реквизиты. Менеджер проверит её в рабочее время."
      : step === "confirm"
        ? "Данные из ЕГРЮЛ по ИНН. Если всё верно, отправьте организацию на проверку."
        : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          {lead && <DialogDescription>{lead}</DialogDescription>}
        </DialogHeader>
        <form ref={formRef} id="add-org-form" noValidate onSubmit={onSubmit} className="space-y-4">
          {step === "inn" && (
            <Field id="add-org-inn" label="ИНН" error={errors.inn} hint="10 цифр у организации, 12 у ИП">
              <Input
                name="inn"
                inputMode="numeric"
                autoComplete="off"
                maxLength={16}
                autoFocus
                value={inn}
                onChange={(e) => {
                  setInn(e.target.value);
                  if (errors.inn) setErrors({});
                }}
                className={cn(FIELD, "tabular-nums")}
                {...describedBy("add-org-inn", errors.inn, true)}
              />
            </Field>
          )}

          {step === "confirm" && found && (
            <>
              <CompanyCard company={found} />
              {STATUS[found.status] && (
                <p className="flex gap-2 text-sm text-amber-700">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  По данным ЕГРЮЛ организация {STATUS[found.status]}.
                </p>
              )}
              {refused ? (
                <FormError>{refused}</FormError>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEdited(true);
                    go("manual");
                  }}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  <PencilLine className="size-3.5" />
                  Реквизиты отличаются — поправить вручную
                </button>
              )}
            </>
          )}

          {step === "manual" && (
            <>
              <ManualNote lookup={result} edited={edited} />
              {refused && compact(values.inn) === lookup?.inn && <FormError>{refused}</FormError>}
              <div className="grid gap-4 sm:grid-cols-2">
                <RequisitesFields
                  id="add-org"
                  values={values}
                  errors={errors}
                  onChange={(key, value) => {
                    setValues((v) => ({ ...v, [key]: value }));
                    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
                  }}
                />
              </div>
            </>
          )}

          {error && !(step === "manual" && errors.inn === error) && <FormError>{error}</FormError>}
        </form>

        <DialogFooter className={DIALOG_FOOT}>
          {step === "inn" && (
            <>
              <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" form="add-org-form" disabled={pending}>
                {pending ? <LoaderCircle className="animate-spin" /> : <Search />}
                {pending ? "Ищем организацию…" : "Найти"}
              </Button>
            </>
          )}
          {step === "confirm" && (
            <>
              <Button variant="ghost" disabled={pending} onClick={() => go("inn")}>
                Нет — изменить ИНН
              </Button>
              <Button type="submit" form="add-org-form" disabled={pending || !!refused}>
                {pending && <LoaderCircle className="animate-spin" />}
                Да, это наша организация
              </Button>
            </>
          )}
          {step === "manual" && (
            <>
              <Button variant="ghost" disabled={pending} onClick={() => go(edited && found ? "confirm" : "inn")}>
                <ArrowLeft />
                Назад
              </Button>
              <Button type="submit" form="add-org-form" disabled={pending}>
                {pending && <LoaderCircle className="animate-spin" />}
                Отправить на проверку
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompanyCard({ company: c }: { company: Company }) {
  return (
    <div className="rounded-2xl bg-muted/50 p-4 ring-1 ring-foreground/5">
      <div className="flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-background text-primary ring-1 ring-foreground/10">
          <Building2 className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="leading-snug font-semibold break-words">{c.name}</p>
          <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
            ИНН {c.inn}
            {c.kpp && ` · КПП ${c.kpp}`}
          </p>
        </div>
      </div>
      <dl className="mt-3 space-y-1.5 text-sm">
        {c.ogrn && <Row label={c.sole_trader ? "ОГРНИП" : "ОГРН"}>{c.ogrn}</Row>}
        {c.manager && <Row label="Руководитель">{c.manager}</Row>}
        {c.address && <Row label="Адрес">{c.address}</Row>}
      </dl>
    </div>
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
