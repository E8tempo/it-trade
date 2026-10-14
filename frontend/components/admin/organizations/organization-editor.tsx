"use client";

import { Check, ExternalLink, LoaderCircle, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/admin/orders/order-fields";
import { OrdersTable } from "@/components/admin/orders/orders-table";
import { Empty, OrgStatusBadge, Panel } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorText } from "@/lib/admin/errors";
import { contractTerms, day, when } from "@/lib/admin/labels";
import type { AdminOrganization, Contract, ContractInput, ContractTerms, MemberRole, OrganizationInput, OrganizationStatus } from "@/lib/admin/types";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type Run = (section: string, request: () => Promise<unknown>, done: string) => Promise<boolean>;

export function OrganizationEditor({ org }: { org: AdminOrganization }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const run: Run = async (section, request, done) => {
    setBusy(section);
    try {
      await request();
      toast.success(done);
      router.refresh();
      return true;
    } catch (e) {
      toast.error(apiErrorText(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <RequisitesPanel key={`req-${org.updated_at}`} org={org} busy={busy === "requisites"} run={run} />
        <ContractsPanel key={`contracts-${org.updated_at}`} org={org} busy={busy} run={run} />
        <Panel title="Заказы для организации">
          <OrdersTable orders={org.orders} />
        </Panel>
      </div>
      <div className="space-y-6">
        <ReviewPanel key={`review-${org.updated_at}`} org={org} busy={busy === "review"} run={run} />
        <MembersPanel key={`members-${org.updated_at}`} org={org} busy={busy === "members"} run={run} />
        <DeletePanel org={org} busy={busy === "delete"} />
      </div>
    </div>
  );
}

const ROLES: Record<MemberRole, string> = { owner: "Руководитель", buyer: "Закупщик" };

/**
 * The organization's people: users of the site who see its prices and order for it. The head changes its
 * requisites and sees every order; a purchaser orders and sees their own. A new person registers first.
 */
function MembersPanel({ org, busy, run }: { org: AdminOrganization; busy: boolean; run: Run }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("buyer");
  const base = `/api/admin/organizations/${org.id}/members`;
  const add = () =>
    run("members", () => api(base, { method: "POST", body: JSON.stringify({ email, role }) }), "Сотрудник добавлен").then((ok) => ok && setEmail(""));
  return (
    <Panel title="Сотрудники">
      <ul className="space-y-3">
        {org.members.map((m) => (
          <li key={m.id} className="space-y-1.5 border-b pb-3 text-sm last:border-0 last:pb-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{m.name || m.email}</p>
                <p className="truncate text-xs text-muted-foreground">
                  <a href={`mailto:${m.email}`} className="hover:text-primary">
                    {m.email}
                  </a>
                  {m.phone && (
                    <>
                      {" · "}
                      <a href={`tel:${m.phone.replace(/[^+\d]/g, "")}`} className="hover:text-primary">
                        {m.phone}
                      </a>
                    </>
                  )}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Убрать из организации: ${m.email}`}
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Убрать ${m.email} из организации? Он перестанет видеть её цены и заказы.`))
                    void run("members", () => api(`${base}/${m.id}`, { method: "DELETE" }), "Сотрудник убран");
                }}
              >
                <X />
              </Button>
            </div>
            <Select
              items={ROLES}
              value={m.role}
              onValueChange={(v) =>
                v && v !== m.role && void run("members", () => api(`${base}/${m.id}`, { method: "PUT", body: JSON.stringify({ role: v }) }), "Роль изменена")
              }
            >
              <SelectTrigger className="h-8 w-40" aria-label={`Роль: ${m.email}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROLES).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-2 border-t pt-4">
        <Field label="Добавить по e-mail (человек уже зарегистрирован на сайте)">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.ru" className="h-9" />
        </Field>
        <div className="flex gap-2">
          <Select items={ROLES} value={role} onValueChange={(v) => v && setRole(v as MemberRole)}>
            <SelectTrigger className="h-9 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ROLES).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" disabled={busy || !email.includes("@")} onClick={() => void add()}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Plus />}
            Добавить
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Добавлена {when(org.created_at)}.</p>
      </div>
    </Panel>
  );
}

const REVIEW_DONE: Record<OrganizationStatus, string> = {
  approved: "Организация подтверждена: её сотрудникам доступны цены и заказы",
  rejected: "Организация отклонена",
  pending: "Организация снова на проверке",
};

/** Approve (wholesale prices for the customer), reject with a reason the customer sees, or return to the check. */
function ReviewPanel({ org, busy, run }: { org: AdminOrganization; busy: boolean; run: Run }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState(org.review_note ?? "");
  const review = (status: OrganizationStatus) =>
    run(
      "review",
      () => api(`/api/admin/organizations/${org.id}/review`, { method: "POST", body: JSON.stringify({ status, note: status === "rejected" ? note : null }) }),
      REVIEW_DONE[status],
    );

  return (
    <Panel title="Проверка" action={<OrgStatusBadge status={org.status} />}>
      <div className="space-y-3 text-sm">
        {org.status === "pending" ? (
          <p className="text-muted-foreground">
            Сверьте название и ИНН с выпиской ЕГРЮЛ/ЕГРИП и позвоните руководителю: действительно ли он представляет организацию. После подтверждения её
            сотрудники увидят цены и смогут заказывать.
          </p>
        ) : (
          <p className="text-muted-foreground">
            {org.status === "approved" ? "Подтвердил" : "Отклонил"} {org.reviewed_by ?? "—"}, {when(org.reviewed_at)}
          </p>
        )}
        {org.status === "rejected" && org.review_note && <p className="rounded-lg bg-red-500/8 px-3 py-2">Причина: {org.review_note}</p>}
        <a href="https://egrul.nalog.ru/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline">
          Проверить в ЕГРЮЛ ФНС
          <ExternalLink className="size-3.5" />
        </a>

        {rejecting ? (
          <div className="space-y-2 border-t pt-3">
            <Field label="Причина отказа (клиент увидит её в кабинете)">
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Например: ИНН не совпадает с названием" />
            </Field>
            <div className="flex gap-2">
              <Button variant="destructive" className="flex-1" disabled={busy || !note.trim()} onClick={() => void review("rejected").then((ok) => ok && setRejecting(false))}>
                {busy && <LoaderCircle className="animate-spin" />}
                Отклонить
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
                Отмена
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {org.status !== "approved" && (
              <Button className="flex-1" disabled={busy} onClick={() => void review("approved")}>
                {busy ? <LoaderCircle className="animate-spin" /> : <Check />}
                Подтвердить
              </Button>
            )}
            {org.status !== "rejected" && (
              <Button variant="outline" className="flex-1" disabled={busy} onClick={() => setRejecting(true)}>
                <X />
                Отклонить
              </Button>
            )}
            {org.status !== "pending" && (
              <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => void review("pending")}>
                <Undo2 />
                Вернуть на проверку
              </Button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

type ReqKey = keyof OrganizationInput;
const REQ_FIELDS: { key: ReqKey; label: string; wide?: boolean }[] = [
  { key: "name", label: "Название", wide: true },
  { key: "inn", label: "ИНН" },
  { key: "kpp", label: "КПП" },
  { key: "ogrn", label: "ОГРН / ОГРНИП" },
  { key: "address", label: "Юридический адрес", wide: true },
];

/** The requisites, as the customer entered them; a manager's correction keeps the status. */
function RequisitesPanel({ org, busy, run }: { org: AdminOrganization; busy: boolean; run: Run }) {
  const initial = { name: org.name, inn: org.inn, kpp: org.kpp ?? "", ogrn: org.ogrn ?? "", address: org.address ?? "" };
  const [values, setValues] = useState<Record<ReqKey, string>>(initial);
  const dirty = REQ_FIELDS.some(({ key }) => values[key].trim() !== initial[key]);
  const save = () =>
    run(
      "requisites",
      () =>
        api(`/api/admin/organizations/${org.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: values.name,
            inn: values.inn,
            kpp: values.kpp || null,
            ogrn: values.ogrn || null,
            address: values.address || null,
          }),
        }),
      "Реквизиты сохранены",
    );
  return (
    <Panel title="Реквизиты">
      <div className="grid gap-3 sm:grid-cols-3">
        {REQ_FIELDS.map(({ key, label, wide }) => (
          <Field key={key} label={label} className={cn(wide && "sm:col-span-3")}>
            <Input value={values[key]} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} className="h-9" />
          </Field>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={busy || !dirty} onClick={() => void save()}>
          {busy && <LoaderCircle className="animate-spin" />}
          Сохранить реквизиты
        </Button>
        <p className="text-xs text-muted-foreground">Статус проверки не меняется. Заказы хранят реквизиты на момент оформления.</p>
      </div>
    </Panel>
  );
}

const TERMS: Record<ContractTerms, string> = { prepayment: "Предоплата", deferred: "Отсрочка платежа" };

function emptyContract(): ContractInput {
  return { number: "", signed_on: new Date().toISOString().slice(0, 10), terms: "prepayment", deferral_days: null, is_active: true };
}

/** Contracts with the shop: the customer picks one at checkout (active ones only). */
function ContractsPanel({ org, busy, run }: { org: AdminOrganization; busy: string | null; run: Run }) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const save = (c: ContractInput, id: number | null) =>
    run(
      "contract",
      () =>
        id == null
          ? api(`/api/admin/organizations/${org.id}/contracts`, { method: "POST", body: JSON.stringify(c) })
          : api(`/api/admin/contracts/${id}`, { method: "PUT", body: JSON.stringify(c) }),
      id == null ? "Договор добавлен" : "Договор сохранён",
    ).then((ok) => ok && setEditing(null));
  const remove = (c: Contract) =>
    run("contract", () => api(`/api/admin/contracts/${c.id}`, { method: "DELETE" }), `Договор № ${c.number} удалён`);

  return (
    <Panel
      title="Договоры"
      action={
        editing !== "new" && (
          <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
            <Plus />
            Добавить договор
          </Button>
        )
      }
    >
      <div className="space-y-2">
        {editing === "new" && <ContractForm initial={emptyContract()} busy={busy === "contract"} onSave={(c) => save(c, null)} onCancel={() => setEditing(null)} />}
        {org.contracts.map((c) =>
          editing === c.id ? (
            <ContractForm key={c.id} initial={c} busy={busy === "contract"} onSave={(v) => save(v, c.id)} onCancel={() => setEditing(null)} />
          ) : (
            <div key={c.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3.5 py-2.5 text-sm", !c.is_active && "bg-muted/40 text-muted-foreground")}>
              <div className="min-w-0 flex-1">
                <span className="font-medium">№ {c.number}</span> от {day(c.signed_on)} · {contractTerms(c)}
                {!c.is_active && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">закрыт</span>}
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon-sm" aria-label={`Изменить договор № ${c.number}`} disabled={!!busy} onClick={() => setEditing(c.id)}>
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Удалить договор № ${c.number}`}
                  disabled={!!busy}
                  onClick={() => {
                    if (window.confirm(`Удалить договор № ${c.number}? Заказы сохранят его номер и дату.`)) void remove(c);
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ),
        )}
        {!org.contracts.length && editing !== "new" && <Empty>Договоров нет. Без договора клиент оформляет заказ, а менеджер уточняет условия.</Empty>}
      </div>
    </Panel>
  );
}

function ContractForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: ContractInput;
  busy: boolean;
  onSave: (c: ContractInput) => void;
  onCancel: () => void;
}) {
  const [c, setC] = useState<ContractInput>({ ...initial });
  const deferred = c.terms === "deferred";
  const valid = c.number.trim() && c.signed_on && (!deferred || (c.deferral_days != null && c.deferral_days >= 1 && c.deferral_days <= 365));
  return (
    <div className="space-y-3 rounded-xl border bg-muted/30 p-3.5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Номер">
          <Input value={c.number} maxLength={64} onChange={(e) => setC({ ...c, number: e.target.value })} className="h-9" />
        </Field>
        <Field label="Дата">
          <Input type="date" value={c.signed_on} onChange={(e) => setC({ ...c, signed_on: e.target.value })} className="h-9" />
        </Field>
        <Field label="Условия оплаты">
          <Select items={TERMS} value={c.terms} onValueChange={(v) => v && setC({ ...c, terms: v as ContractTerms, deferral_days: v === "deferred" ? (c.deferral_days ?? 14) : null })}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TERMS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {deferred && (
          <Field label="Отсрочка, дней">
            <Input
              type="number"
              min={1}
              max={365}
              value={c.deferral_days ?? ""}
              onChange={(e) => setC({ ...c, deferral_days: e.target.value ? Number(e.target.value) : null })}
              className="h-9"
            />
          </Field>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={c.is_active} onCheckedChange={(v) => setC({ ...c, is_active: v })} />
        Действует — клиент может выбрать его при оформлении заказа
      </label>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !valid} onClick={() => onSave({ ...c, number: c.number.trim() })}>
          {busy && <LoaderCircle className="animate-spin" />}
          Сохранить
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

function DeletePanel({ org, busy }: { org: AdminOrganization; busy: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const remove = async () => {
    if (!window.confirm(`Удалить «${org.name}» вместе с договорами? Заказы сохранят реквизиты.`)) return;
    setPending(true);
    try {
      await api(`/api/admin/organizations/${org.id}`, { method: "DELETE" });
      toast.success("Организация удалена");
      router.push("/admin/organizations");
      router.refresh();
    } catch (e) {
      toast.error(apiErrorText(e));
      setPending(false);
    }
  };
  return (
    <Panel title="Удаление">
      <p className="mb-3 text-sm text-muted-foreground">Организация пропадёт из кабинетов её сотрудников вместе с договорами. Заказы сохранят её реквизиты.</p>
      <Button variant="outline" className="w-full text-destructive" disabled={busy || pending} onClick={() => void remove()}>
        {pending ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
        Удалить организацию
      </Button>
    </Panel>
  );
}
