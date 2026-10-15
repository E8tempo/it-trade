"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { numberText, parseNumber } from "@/components/account/quotes/fields";
import { VAT_ITEMS } from "@/components/account/quotes/labels";
import { errorMessage } from "@/components/shop/errors";
import { FormError } from "@/components/shop/form";
import { useCart, useSession } from "@/components/shop/session-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api/client";
import type { QuoteProfile, QuoteProfileOut } from "@/lib/types";
import { cn } from "@/lib/utils";

type Text = Record<keyof QuoteProfile, string>;

const TEXT_KEYS = ["phone", "email", "website", "bank_name", "bik", "account", "corr_account", "signer_title", "signer_name", "terms"] as const;

function toText(p: QuoteProfile): Text {
  return {
    ...(Object.fromEntries(TEXT_KEYS.map((k) => [k, p[k] ?? ""])) as Record<(typeof TEXT_KEYS)[number], string>),
    markup_percent: numberText(p.markup_percent),
    vat_rate: p.vat_rate == null ? "none" : String(p.vat_rate),
    valid_days: p.valid_days == null ? "" : String(p.valid_days),
  };
}

/** What a mistake in a field looks like to the client, before the API is asked. */
function check(t: Text): string | null {
  const digits = (s: string) => s.replace(/\s/g, "");
  if (t.bik && !/^\d{9}$/.test(digits(t.bik))) return "БИК — 9 цифр";
  if (t.account && !/^\d{20}$/.test(digits(t.account))) return "Расчётный счёт — 20 цифр";
  if (t.corr_account && !/^\d{20}$/.test(digits(t.corr_account))) return "Корреспондентский счёт — 20 цифр";
  const m = parseNumber(t.markup_percent);
  if (m == null || m < 0 || m > 10000) return "Проверьте наценку";
  const d = parseNumber(t.valid_days);
  if (d === undefined || (d != null && (d < 1 || d > 365 || !Number.isInteger(d)))) return "Срок действия — от 1 до 365 дней";
  return null;
}

/**
 * What the offers of the organization the user works for print besides its requisites — contacts, bank details,
 * who signs — and how a new offer starts. Its head edits it, a purchaser sees it.
 */
export function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { keepSession } = useSession();
  const { cart } = useCart();
  const org = cart?.organization ?? null;
  const orgId = org?.id ?? null;
  const [loaded, setLoaded] = useState<{ orgId: number; profile: QuoteProfileOut } | null>(null);
  const [text, setText] = useState<Text | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || orgId == null) return;
    let alive = true;
    keepSession()
      .then(() => api<QuoteProfileOut>(`/api/quotes/profile/${orgId}`))
      .then(
        (p) => {
          if (!alive) return;
          setLoaded({ orgId, profile: p });
          setText(toText(p));
          setFailed(null);
          setError(null);
        },
        (e: unknown) => alive && setFailed(errorMessage(e, "Не удалось загрузить реквизиты для КП.")),
      );
    return () => {
      alive = false;
    };
  }, [open, orgId, keepSession]);

  const ready = loaded && org && loaded.orgId === org.id && text;
  const canEdit = !!ready && loaded.profile.can_edit;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !org) return;
    const problem = check(text);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    const body = {
      ...Object.fromEntries(TEXT_KEYS.map((k) => [k, text[k].trim() || null])),
      markup_percent: parseNumber(text.markup_percent),
      vat_rate: text.vat_rate === "none" ? null : Number(text.vat_rate),
      valid_days: parseNumber(text.valid_days),
    };
    keepSession()
      .then(() => api<QuoteProfileOut>(`/api/quotes/profile/${org.id}`, { method: "PUT", body: JSON.stringify(body) }))
      .then(
        (p) => {
          setLoaded({ orgId: org.id, profile: p });
          toast.success("Реквизиты для КП сохранены");
          onOpenChange(false);
        },
        (e: unknown) => setError(errorMessage(e, "Не удалось сохранить. Проверьте поля.")),
      )
      .finally(() => setBusy(false));
  };

  const field = (key: keyof Text, label: string, props: { placeholder?: string; inputMode?: "numeric" | "decimal" | "email" | "tel"; className?: string } = {}) => (
    <Row label={label} id={`qp-${key}`} className={props.className}>
      <Input
        id={`qp-${key}`}
        value={text?.[key] ?? ""}
        onChange={(e) => setText((t) => t && { ...t, [key]: e.target.value })}
        disabled={!canEdit}
        placeholder={props.placeholder}
        inputMode={props.inputMode}
        className="h-10 rounded-xl"
      />
    </Row>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto p-5 sm:max-w-2xl sm:p-6">
        <DialogHeader>
          <DialogTitle>Реквизиты для КП</DialogTitle>
          <DialogDescription>
            {org ? `${org.name}: ` : ""}название, ИНН, КПП, ОГРН и адрес берутся из карточки организации. Здесь — что ещё печатать в КП и с чего начинать новое.
          </DialogDescription>
        </DialogHeader>
        {failed ? (
          <FormError>{failed}</FormError>
        ) : !ready ? (
          <div className="grid h-60 place-items-center">
            <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            {!canEdit && <p className="rounded-xl bg-muted px-3.5 py-3 text-sm text-muted-foreground">Изменить их может руководитель организации.</p>}
            <Section title="Контакты">
              {field("phone", "Телефон", { placeholder: "+7 978 000-00-00", inputMode: "tel" })}
              {field("email", "E-mail", { placeholder: "sales@company.ru", inputMode: "email" })}
              {field("website", "Сайт", { placeholder: "company.ru" })}
            </Section>
            <Section title="Банк">
              {field("bank_name", "Банк", { placeholder: "РНКБ Банк (ПАО)", className: "sm:col-span-2" })}
              {field("bik", "БИК", { inputMode: "numeric" })}
              {field("account", "Расчётный счёт", { inputMode: "numeric", className: "sm:col-span-2" })}
              {field("corr_account", "Корр. счёт", { inputMode: "numeric", className: "sm:col-span-3" })}
            </Section>
            <Section title="Подпись">
              {field("signer_title", "Должность", { placeholder: "Генеральный директор" })}
              {field("signer_name", "ФИО", { placeholder: "Иванов И. И.", className: "sm:col-span-2" })}
            </Section>
            <Section title="Новое КП начинается с">
              {field("markup_percent", "Наценка, %", { inputMode: "decimal" })}
              <Row label="НДС" id="qp-vat">
                <Select items={VAT_ITEMS} value={text.vat_rate} onValueChange={(v) => v != null && setText((t) => t && { ...t, vat_rate: v })} disabled={!canEdit}>
                  <SelectTrigger id="qp-vat" className="h-10 w-full rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(VAT_ITEMS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              {field("valid_days", "Действует, дней", { inputMode: "numeric", placeholder: "без срока" })}
              <Row label="Условия" id="qp-terms" className="sm:col-span-3">
                <Textarea
                  id="qp-terms"
                  value={text.terms}
                  onChange={(e) => setText((t) => t && { ...t, terms: e.target.value })}
                  disabled={!canEdit}
                  maxLength={4000}
                  placeholder={"Оплата: 100 % предоплата\nСрок поставки: 3–5 рабочих дней"}
                  className="min-h-24 rounded-xl"
                />
              </Row>
            </Section>
            {error && <FormError>{error}</FormError>}
            {canEdit && (
              <DialogFooter className="-mx-5 -mb-5 rounded-b-xl px-5 sm:-mx-6 sm:-mb-6 sm:px-6">
                <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={() => onOpenChange(false)}>
                  Отмена
                </Button>
                <Button type="submit" className="h-10 gap-2 rounded-xl" disabled={busy}>
                  {busy && <LoaderCircle className="animate-spin" />}
                  Сохранить
                </Button>
              </DialogFooter>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-3">{children}</div>
    </fieldset>
  );
}

function Row({ label, id, className, children }: { label: string; id: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
