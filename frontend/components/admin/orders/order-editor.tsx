"use client";

import { ExternalLink, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { CustomerFields, Field, ItemsEditor, Totals, type Customer, type Line } from "@/components/admin/orders/order-fields";
import { Panel, StatusBadge } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorText } from "@/lib/admin/errors";
import { contractTerms, day, DELIVERY, money, ORDER_STATUSES, PAYMENT, SOURCE, STATUS, when } from "@/lib/admin/labels";
import { PRICE_TYPE, priceType } from "@/lib/admin/suppliers";
import type { Order, OrderStatus, PaymentMethod } from "@/lib/admin/types";
import { api } from "@/lib/api/client";
import { productHref } from "@/lib/urls";

const FINAL: OrderStatus[] = ["completed", "cancelled"];

function customerOf(o: Order): Customer {
  return {
    customer_name: o.customer_name,
    phone: o.phone,
    email: o.email ?? "",
    delivery: o.delivery,
    city: o.city ?? "",
    address: o.address ?? "",
    comment: o.comment ?? "",
  };
}

function linesOf(o: Order): Line[] {
  return o.items.map((i) => ({ sku: i.sku, name: i.name, price: i.price, qty: i.qty, supplier_price: i.supplier_price }));
}

export function OrderEditor({ order }: { order: Order }) {
  const router = useRouter();
  const final = FINAL.includes(order.status);
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(section: string, body: Record<string, unknown>, done: string) {
    setBusy(section);
    try {
      await api<Order>(`/api/admin/orders/${order.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success(done);
      router.refresh();
    } catch (e) {
      toast.error(apiErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <ItemsPanel key={`items-${order.updated_at}`} order={order} final={final} busy={busy === "items"} onSave={patch} />
        {order.buyer && <BuyerPanel order={order} />}
        <CustomerPanel key={`customer-${order.updated_at}`} order={order} busy={busy === "customer"} onSave={patch} />
        <History order={order} />
      </div>
      <div className="space-y-6">
        <StatusPanel key={`status-${order.updated_at}`} order={order} busy={busy === "status"} onSave={patch} />
        <PaymentPanel key={`payment-${order.updated_at}`} order={order} busy={busy === "payment"} onSave={patch} />
        <Panel title="Сведения">
          <dl className="space-y-2 text-sm">
            <Info label="Создан" value={when(order.created_at)} />
            <Info label="Изменён" value={when(order.updated_at)} />
            <Info label="Источник" value={SOURCE[order.source]} />
            <Info label="Аккаунт на сайте" value={order.user_id != null ? "есть" : "нет"} />
            <Info label="Получение" value={DELIVERY[order.delivery]} />
            <Info label="Закупка" value={money(order.cost_total)} />
          </dl>
        </Panel>
        <NotePanel key={`note-${order.updated_at}`} order={order} busy={busy === "note"} onSave={patch} />
      </div>
    </div>
  );
}

type SaveFn = (section: string, body: Record<string, unknown>, done: string) => Promise<void>;

function StatusPanel({ order, busy, onSave }: { order: Order; busy: boolean; onSave: SaveFn }) {
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [note, setNote] = useState("");
  const labels = Object.fromEntries(ORDER_STATUSES.map((s) => [s.value, s.label]));
  return (
    <Panel title="Статус" action={<StatusBadge status={order.status} />}>
      <div className="space-y-3">
        <Select items={labels} value={status} onValueChange={(v) => v && setStatus(v as OrderStatus)}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORDER_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Комментарий в историю (необязательно)" />
        <Button
          className="w-full"
          disabled={busy || (status === order.status && !note.trim())}
          onClick={() =>
            onSave(
              "status",
              { ...(status !== order.status && { status }), ...(note.trim() && { note: note.trim() }) },
              status !== order.status ? `Статус: ${STATUS[status].label}` : "Комментарий добавлен",
            )
          }
        >
          {busy && <LoaderCircle className="animate-spin" />}
          {status !== order.status ? "Сменить статус" : "Добавить комментарий"}
        </Button>
      </div>
    </Panel>
  );
}

/** How the customer pays and whose prices apply. The lines keep the prices they were added with. */
function PaymentPanel({ order, busy, onSave }: { order: Order; busy: boolean; onSave: SaveFn }) {
  const retail = PRICE_TYPE[order.price_type].audience === "retail"; // an order from before the shop went wholesale only
  const [payment, setPayment] = useState<PaymentMethod>(order.payment_method);
  const changes = [payment !== order.payment_method && `Оплата: ${PAYMENT[payment]}`, retail && "Цены: опт"].filter(Boolean);
  return (
    <Panel title="Оплата и цены">
      <div className="space-y-3">
        <Field label="Оплата">
          <Select items={PAYMENT} value={payment} onValueChange={(v) => v && setPayment(v as PaymentMethod)}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PAYMENT).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {retail && <p className="text-xs text-amber-700">Заказ оформлен по розничным ценам. После сохранения новые товары пойдут по оптовым.</p>}
        <p className="text-xs text-muted-foreground">
          Цены товаров, которые уже в заказе, не изменятся. Новые товары добавятся по цене «{PRICE_TYPE[priceType("wholesale", payment)].label}».
        </p>
        <Button
          variant="outline"
          className="w-full"
          disabled={busy || changes.length === 0}
          onClick={() =>
            onSave(
              "payment",
              { ...(payment !== order.payment_method && { payment_method: payment }), ...(retail && { audience: "wholesale" }) },
              changes.join(", "),
            )
          }
        >
          {busy && <LoaderCircle className="animate-spin" />}
          Сохранить
        </Button>
      </div>
    </Panel>
  );
}

function ItemsPanel({ order, final, busy, onSave }: { order: Order; final: boolean; busy: boolean; onSave: SaveFn }) {
  const [lines, setLines] = useState<Line[]>(linesOf(order));
  const [delivery, setDelivery] = useState(order.delivery_price);
  const [discount, setDiscount] = useState(order.discount);
  const dirty =
    JSON.stringify(lines) !== JSON.stringify(linesOf(order)) || delivery !== order.delivery_price || discount !== order.discount;
  return (
    <Panel title="Состав заказа">
      {final && <p className="mb-3 text-sm text-muted-foreground">Заказ {STATUS[order.status].label.toLowerCase()}, состав больше не меняется.</p>}
      <ItemsEditor lines={lines} onChange={setLines} priceType={order.price_type} disabled={final} />
      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
        {order.items
          .filter((i) => i.slug)
          .map((i) => (
            <li key={i.id}>
              <a href={productHref({ sku: i.sku, slug: i.slug! })} target="_blank" className="inline-flex items-center gap-1 hover:text-foreground">
                <ExternalLink className="size-3" />
                {i.name}
              </a>
            </li>
          ))}
      </ul>
      <div className="mt-5 grid grid-cols-1 gap-6 border-t pt-5 sm:grid-cols-2">
        <div className="grid grid-cols-2 gap-3 self-start">
          <Field label="Доставка, ₽">
            <Input type="number" min={0} value={delivery} onChange={(e) => setDelivery(Number(e.target.value) || 0)} disabled={final} className="h-9" />
          </Field>
          <Field label="Скидка, ₽">
            <Input type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} disabled={final} className="h-9" />
          </Field>
        </div>
        <Totals lines={lines} delivery={delivery} discount={discount} />
      </div>
      {!final && (
        <div className="mt-4 flex justify-end">
          <Button
            disabled={busy || !dirty || lines.length === 0}
            onClick={() =>
              onSave(
                "items",
                { items: lines.map((l) => ({ sku: l.sku, qty: l.qty, price: l.price })), delivery_price: delivery, discount },
                "Состав заказа сохранён",
              )
            }
          >
            {busy && <LoaderCircle className="animate-spin" />}
            Сохранить состав
          </Button>
        </div>
      )}
    </Panel>
  );
}

function CustomerPanel({ order, busy, onSave }: { order: Order; busy: boolean; onSave: SaveFn }) {
  const [value, setValue] = useState<Customer>(customerOf(order));
  const dirty = JSON.stringify(value) !== JSON.stringify(customerOf(order));
  return (
    <Panel title="Покупатель">
      <CustomerFields value={value} onChange={setValue} />
      <div className="mt-4 flex justify-end">
        <Button
          disabled={busy || !dirty}
          onClick={() =>
            onSave(
              "customer",
              {
                ...value,
                email: value.email || null,
                city: value.city || null,
                address: value.address || null,
                comment: value.comment || null,
              },
              "Данные покупателя сохранены",
            )
          }
        >
          {busy && <LoaderCircle className="animate-spin" />}
          Сохранить
        </Button>
      </div>
    </Panel>
  );
}

function NotePanel({ order, busy, onSave }: { order: Order; busy: boolean; onSave: SaveFn }) {
  const [note, setNote] = useState(order.manager_note ?? "");
  return (
    <Panel title="Заметка менеджера">
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="Покупатель её не видит" />
      <Button
        variant="outline"
        className="mt-3 w-full"
        disabled={busy || note === (order.manager_note ?? "")}
        onClick={() => onSave("note", { manager_note: note || null }, "Заметка сохранена")}
      >
        {busy && <LoaderCircle className="animate-spin" />}
        Сохранить заметку
      </Button>
    </Panel>
  );
}

/** The organization the order was placed for, with the requisites and contract as they were at checkout. */
function BuyerPanel({ order }: { order: Order }) {
  const b = order.buyer!;
  return (
    <Panel
      title="Организация"
      action={
        order.organization_id != null ? (
          <Link href={`/admin/organizations/${order.organization_id}`} className="text-sm text-primary hover:underline">
            Карточка организации
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">удалена</span>
        )
      }
    >
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Info label="Название" value={b.name} />
        <Info label="ИНН" value={b.inn} />
        {b.kpp && <Info label="КПП" value={b.kpp} />}
        {b.ogrn && <Info label={b.ogrn.length === 15 ? "ОГРНИП" : "ОГРН"} value={b.ogrn} />}
        {b.address && <Info label="Адрес" value={b.address} />}
        <Info
          label="Договор"
          value={b.contract ? `№ ${b.contract.number} от ${day(b.contract.signed_on)}, ${contractTerms(b.contract)}` : "не выбран"}
        />
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">Реквизиты на момент оформления заказа.</p>
    </Panel>
  );
}

function History({ order }: { order: Order }) {
  return (
    <Panel title="История">
      <ol className="relative space-y-4 border-l pl-5">
        {[...order.events].reverse().map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-primary ring-4 ring-background" />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {e.status && <StatusBadge status={e.status} />}
              <span className="text-muted-foreground">
                {when(e.at)}
                {e.author && <> · {e.author}</>}
              </span>
            </div>
            {e.note && <p className="mt-1 text-sm">{e.note}</p>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
