"use client";

import { Building2, CircleAlert, Clock, FileText, LoaderCircle, Pencil, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { AccountSkeleton, PageHeading } from "@/components/account/account-shell";
import { LoadError } from "@/components/account/orders-view";
import { compact, innError, KPP, validOgrn } from "@/components/account/requisites";
import { ACCOUNT_CARD, CARD_FOOT, CARD_HEAD, Pill } from "@/components/account/ui";
import { errorMessage } from "@/components/shop/errors";
import { describedBy, Field, FIELD, FormError, type FieldErrors } from "@/components/shop/form";
import { contractTerms, ORG_STATUS } from "@/components/shop/labels";
import { useCart, useSession } from "@/components/shop/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import type { Organization, OrganizationInput } from "@/lib/types";
import { cn } from "@/lib/utils";

const DIALOG = "gap-5 p-5 sm:max-w-lg sm:p-6";
const DIALOG_FOOT = "-mx-5 -mb-5 rounded-b-xl px-5 sm:-mx-6 sm:-mb-6 sm:px-6";

/**
 * The organizations the client works for. A manager checks each one; an approved organization's prices, cart and
 * orders open, and the manager enters its contracts. Its head changes the requisites (in a dialog).
 */
export function OrganizationsView() {
  const { organizations, refreshOrganizations } = useSession();
  const [adding, setAdding] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const retry = () => {
    setFailed(null);
    refreshOrganizations().catch((e: unknown) => setFailed(errorMessage(e, "Не удалось загрузить организации.")));
  };

  if (failed) return <LoadError message={failed} onRetry={retry} />;
  if (!organizations) return <AccountSkeleton />;

  return (
    <div className="max-w-4xl">
      <PageHeading
        title="Организации"
        lead="Компании и ИП, от которых вы работаете. Цены, корзина и заказы относятся к выбранной организации — её можно сменить в любой момент."
        action={
          <Button className="h-10 gap-2 rounded-xl px-4" onClick={() => setAdding(true)}>
            <Plus />
            Добавить организацию
          </Button>
        }
      />
      {organizations.length ? (
        <div className="space-y-6">
          {organizations.map((o) => (
            <OrganizationCard key={o.id} org={o} />
          ))}
          <p className="text-sm text-muted-foreground">
            Сотрудников в организацию пока добавляет менеджер — напишите или позвоните нам, назовите e-mail сотрудника.
          </p>
        </div>
      ) : (
        <NoOrganizations onAdd={() => setAdding(true)} />
      )}
      <OrganizationDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function OrganizationCard({ org }: { org: Organization }) {
  const { cart, setBuyer } = useCart();
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const [switching, setSwitching] = useState(false);
  const status = ORG_STATUS[org.status];
  const current = cart?.organization.id === org.id;
  const head = org.role === "owner";
  const contracts = org.contracts;

  const workFor = () => {
    setSwitching(true);
    setBuyer(org.id)
      .then(
        () => toast.success(`Цены и корзина — для ${org.name}`),
        (e: unknown) => toast.error(errorMessage(e, "Не удалось переключить организацию")),
      )
      .finally(() => setSwitching(false));
  };

  return (
    <Card className={cn(ACCOUNT_CARD, current && "ring-primary/30")}>
      <CardHeader className={CARD_HEAD}>
        <div className="flex min-w-0 items-center gap-4">
          <span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl", current ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
            <Building2 className="size-5" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-lg leading-snug font-semibold break-words">{org.name}</CardTitle>
            <CardDescription className="mt-1 flex flex-wrap gap-1.5">
              <Pill tone={status.tone}>{status.label}</Pill>
              <Pill>{head ? "Вы руководитель" : "Вы закупщик"}</Pill>
              {current && <Pill tone="bg-primary/10 text-primary">Вы работаете от неё</Pill>}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 py-(--card-spacing)">
        {org.status === "pending" && (
          <Notice icon={<Clock className="size-4 text-amber-700" />} tone="bg-amber-500/10">
            Менеджер проверит реквизиты в рабочее время. После подтверждения откроются цены, корзина и заказы.
          </Notice>
        )}
        {org.status === "rejected" && (
          <Notice icon={<CircleAlert className="size-4 text-destructive" />} tone="bg-destructive/8">
            <span className="font-medium">Не подтверждена{org.review_note ? `: ${org.review_note}` : "."}</span>{" "}
            {head ? "Исправьте реквизиты — организация снова уйдёт на проверку." : "Реквизиты может исправить руководитель организации."}
          </Notice>
        )}

        <section>
          <h3 className="mb-3 text-sm font-semibold">Реквизиты</h3>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
            <Requisite label="ИНН">{org.inn}</Requisite>
            <Requisite label="КПП">{org.kpp}</Requisite>
            <Requisite label={org.inn.length === 12 ? "ОГРНИП" : "ОГРН"}>{org.ogrn}</Requisite>
            <Requisite label="Юридический адрес" wide>
              {org.address}
            </Requisite>
          </dl>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold">Договоры</h3>
          {contracts.length ? (
            <ul className="divide-y rounded-2xl border">
              {contracts.map((c) => (
                <li key={c.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm", !c.is_active && "text-muted-foreground")}>
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">№ {c.number}</span>
                  <span className="text-muted-foreground">от {formatDate(c.signed_on)}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-muted-foreground">{contractTerms(c)}</span>
                    {!c.is_active && <Pill>закрыт</Pill>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              Договора пока нет — менеджер оформит его после проверки. Заказывать можно и без договора.
            </p>
          )}
        </section>
      </CardContent>

      {(head || (org.status === "approved" && !current)) && (
        <CardFooter className={CARD_FOOT}>
          {org.status === "approved" && !current && (
            <Button className="gap-2 rounded-xl" disabled={switching} onClick={workFor}>
              {switching ? <LoaderCircle className="animate-spin" /> : <ShoppingCart />}
              Работать от неё
            </Button>
          )}
          {head && (
            <Button variant="outline" className="gap-2 rounded-xl bg-background" onClick={() => setDialog("edit")}>
              <Pencil />
              Изменить реквизиты
            </Button>
          )}
          {head && !contracts.length && (
            <Button variant="ghost" className="ml-auto gap-2 rounded-xl text-muted-foreground hover:text-destructive" onClick={() => setDialog("delete")}>
              <Trash2 />
              Удалить
            </Button>
          )}
        </CardFooter>
      )}

      <OrganizationDialog org={org} open={dialog === "edit"} onOpenChange={(o) => setDialog(o ? "edit" : null)} />
      <DeleteDialog org={org} open={dialog === "delete"} onOpenChange={(o) => setDialog(o ? "delete" : null)} />
    </Card>
  );
}

function Requisite({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-3")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 break-words", children ? "font-medium tabular-nums" : "text-muted-foreground")}>{children || "не указан"}</dd>
    </div>
  );
}

function Notice({ icon, tone, children }: { icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <div className={cn("flex gap-2.5 rounded-2xl p-3.5 text-sm", tone)}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p>{children}</p>
    </div>
  );
}

function DeleteDialog({ org, open, onOpenChange }: { org: Organization; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { refreshOrganizations } = useSession();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/api/account/organizations/${org.id}`, { method: "DELETE" });
      await refreshOrganizations();
      toast.success("Организация удалена");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, "Не удалось удалить организацию"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Удалить {org.name}?</DialogTitle>
          <DialogDescription>Организация пропадёт из кабинета у вас и её сотрудников. Оформленные заказы сохранят её реквизиты.</DialogDescription>
        </DialogHeader>
        <DialogFooter className={DIALOG_FOOT}>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
            {busy && <LoaderCircle className="animate-spin" />}
            Удалить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Key = keyof OrganizationInput;
const KEYS: Key[] = ["inn", "name", "kpp", "ogrn", "address"];

function validate(v: Record<Key, string>): FieldErrors<Key> {
  const inn = compact(v.inn);
  const company = inn.length !== 12;
  const kpp = compact(v.kpp);
  const ogrn = compact(v.ogrn);
  const name = v.name.trim();
  return {
    name: name.length < 2 ? "Укажите название, как в документах" : name.length > 255 ? "Слишком длинное название" : undefined,
    inn: innError(inn),
    kpp: company && kpp && !KPP.test(kpp) ? "КПП — 9 символов" : undefined,
    ogrn: ogrn && (ogrn.length !== (company ? 13 : 15) || !validOgrn(ogrn)) ? (company ? "Проверьте ОГРН: 13 цифр" : "Проверьте ОГРНИП: 15 цифр") : undefined,
    address: v.address.trim().length > 512 ? "Слишком длинный адрес" : undefined,
  };
}

const EMPTY: Record<Key, string> = { name: "", inn: "", kpp: "", ogrn: "", address: "" };

/** Adding an organization (`org` absent) or changing its requisites, in a dialog. */
function OrganizationDialog({ org, open, onOpenChange }: { org?: Organization; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { refreshOrganizations } = useSession();
  const initial = () => (org ? { name: org.name, inn: org.inn, kpp: org.kpp ?? "", ogrn: org.ogrn ?? "", address: org.address ?? "" } : EMPTY);
  const [values, setValues] = useState<Record<Key, string>>(initial);
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const soleTrader = compact(values.inn).length === 12;
  const id = org ? `org-${org.id}` : "org-new";

  const set = (key: Key, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  // every opening starts from the saved requisites
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValues(initial());
      setErrors({});
      setFormError(null);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const found = validate(values);
    setErrors(found);
    setFormError(null);
    const invalid = KEYS.find((k) => found[k]);
    if (invalid) {
      form.querySelector<HTMLElement>(`[name="${invalid}"]`)?.focus();
      return;
    }
    const body: OrganizationInput = {
      name: values.name.trim(),
      inn: compact(values.inn),
      kpp: soleTrader ? null : compact(values.kpp) || null,
      ogrn: compact(values.ogrn) || null,
      address: values.address.trim() || null,
    };
    setSaving(true);
    try {
      const saved = await api<Organization>(org ? `/api/account/organizations/${org.id}` : "/api/account/organizations", {
        method: org ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      await refreshOrganizations().catch(() => undefined);
      if (!org) toast.success("Организация добавлена и отправлена на проверку");
      else if (saved.status === "pending" && org.status !== "pending") toast.success("Реквизиты сохранены, организация снова на проверке");
      else toast.success("Реквизиты сохранены");
      onOpenChange(false);
    } catch (err) {
      setFormError(errorMessage(err, "Не удалось сохранить. Попробуйте ещё раз."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{org ? "Реквизиты организации" : "Новая организация"}</DialogTitle>
          <DialogDescription>
            {org?.status === "approved"
              ? "Организация уже подтверждена: после изменения она снова уйдёт на проверку, и цены будут недоступны до подтверждения."
              : org
                ? "Менеджер проверит реквизиты в рабочее время."
                : "Нужны ИНН и название — остальное по желанию. Менеджер проверит организацию в рабочее время."}
          </DialogDescription>
        </DialogHeader>
        <form id={`${id}-form`} noValidate onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-inn`} label="ИНН" error={errors.inn} hint="10 цифр у организации, 12 у ИП">
            <Input
              name="inn"
              inputMode="numeric"
              autoComplete="off"
              maxLength={16}
              value={values.inn}
              onChange={(e) => set("inn", e.target.value)}
              className={cn(FIELD, "tabular-nums")}
              {...describedBy(`${id}-inn`, errors.inn, true)}
            />
          </Field>
          {!soleTrader ? (
            <Field id={`${id}-kpp`} label="КПП" optional error={errors.kpp}>
              <Input
                name="kpp"
                autoComplete="off"
                maxLength={12}
                value={values.kpp}
                onChange={(e) => set("kpp", e.target.value)}
                className={cn(FIELD, "tabular-nums")}
                {...describedBy(`${id}-kpp`, errors.kpp)}
              />
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          <Field id={`${id}-name`} label="Название" error={errors.name} hint="Как в документах: ООО «Ромашка», ИП Иванов И. И." className="sm:col-span-2">
            <Input
              name="name"
              autoComplete="organization"
              maxLength={255}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              className={FIELD}
              {...describedBy(`${id}-name`, errors.name, true)}
            />
          </Field>
          <Field id={`${id}-ogrn`} label={soleTrader ? "ОГРНИП" : "ОГРН"} optional error={errors.ogrn} className="sm:col-span-2">
            <Input
              name="ogrn"
              inputMode="numeric"
              autoComplete="off"
              maxLength={20}
              value={values.ogrn}
              onChange={(e) => set("ogrn", e.target.value)}
              className={cn(FIELD, "tabular-nums")}
              {...describedBy(`${id}-ogrn`, errors.ogrn)}
            />
          </Field>
          <Field id={`${id}-address`} label="Юридический адрес" optional error={errors.address} className="sm:col-span-2">
            <Input
              name="address"
              autoComplete="off"
              maxLength={512}
              value={values.address}
              onChange={(e) => set("address", e.target.value)}
              className={FIELD}
              {...describedBy(`${id}-address`, errors.address)}
            />
          </Field>
          {formError && (
            <div className="sm:col-span-2">
              <FormError>{formError}</FormError>
            </div>
          )}
        </form>
        <DialogFooter className={DIALOG_FOOT}>
          <Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={saving}>
            {saving && <LoaderCircle className="animate-spin" />}
            {org ? "Сохранить" : "Отправить на проверку"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoOrganizations({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-3xl bg-muted/50 px-6 py-14 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-background shadow-xs">
        <Building2 className="size-6 text-muted-foreground" />
      </span>
      <p className="mt-5 text-lg font-semibold">Организаций пока нет</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">Добавьте компанию или ИП, от которых работаете. Нужны только ИНН и название.</p>
      <Button className="mt-6 h-11 gap-2 rounded-xl px-5" onClick={onAdd}>
        <Plus />
        Добавить организацию
      </Button>
    </div>
  );
}
