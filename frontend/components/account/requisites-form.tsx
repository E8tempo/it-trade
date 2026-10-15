"use client";

import { compact, innError, KPP, validOgrn } from "@/components/account/requisites";
import { describedBy, Field, FIELD, type FieldErrors } from "@/components/shop/form";
import { Input } from "@/components/ui/input";
import type { OrganizationInput } from "@/lib/types";
import { cn } from "@/lib/utils";

export type RequisitesKey = keyof OrganizationInput;
export type Requisites = Record<RequisitesKey, string>;

export const REQUISITES_KEYS: RequisitesKey[] = ["inn", "name", "kpp", "ogrn", "address"];
export const NO_REQUISITES: Requisites = { name: "", inn: "", kpp: "", ogrn: "", address: "" };

/** What is wrong with the requisites typed, as the API would say it. */
export function requisitesErrors(v: Requisites): FieldErrors<RequisitesKey> {
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

/** The body of POST/PUT /api/account/organizations. */
export function requisitesBody(v: Requisites): OrganizationInput {
  const inn = compact(v.inn);
  return {
    name: v.name.trim(),
    inn,
    kpp: inn.length === 12 ? null : compact(v.kpp) || null,
    ogrn: compact(v.ogrn) || null,
    address: v.address.trim() || null,
  };
}

/** The requisites' fields in a two-column grid (put inside a <form>). */
export function RequisitesFields({
  id,
  values,
  errors,
  onChange,
}: {
  id: string;
  values: Requisites;
  errors: FieldErrors<RequisitesKey>;
  onChange: (key: RequisitesKey, value: string) => void;
}) {
  const soleTrader = compact(values.inn).length === 12;
  return (
    <>
      <Field id={`${id}-inn`} label="ИНН" error={errors.inn} hint="10 цифр у организации, 12 у ИП">
        <Input
          name="inn"
          inputMode="numeric"
          autoComplete="off"
          maxLength={16}
          value={values.inn}
          onChange={(e) => onChange("inn", e.target.value)}
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
            onChange={(e) => onChange("kpp", e.target.value)}
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
          onChange={(e) => onChange("name", e.target.value)}
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
          onChange={(e) => onChange("ogrn", e.target.value)}
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
          onChange={(e) => onChange("address", e.target.value)}
          className={FIELD}
          {...describedBy(`${id}-address`, errors.address)}
        />
      </Field>
    </>
  );
}
