"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { CustomerFields, Field, ItemsEditor, Totals, type Customer, type Line } from "@/components/admin/orders/order-fields";
import { Panel } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SOURCE } from "@/lib/admin/labels";
import type { Order, OrderSource } from "@/lib/admin/types";
import { apiErrorText } from "@/lib/admin/errors";
import { api } from "@/lib/api/client";

export function NewOrderForm() {
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer>({
    customer_name: "",
    phone: "",
    email: "",
    delivery: "pickup",
    city: "",
    address: "",
    comment: "",
  });
  const [lines, setLines] = useState<Line[]>([]);
  const [delivery, setDelivery] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [source, setSource] = useState<OrderSource>("phone");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (lines.length === 0) {
      toast.error("Добавьте хотя бы один товар");
      return;
    }
    setPending(true);
    try {
      const order = await api<Order>("/api/admin/orders", {
        method: "POST",
        body: JSON.stringify({
          ...customer,
          email: customer.email || null,
          city: customer.city || null,
          address: customer.address || null,
          comment: customer.comment || null,
          manager_note: note || null,
          source,
          delivery_price: delivery,
          discount,
          items: lines.map((l) => ({ sku: l.sku, qty: l.qty, price: l.price })),
        }),
      });
      toast.success(`Заказ ${order.number} создан`);
      router.push(`/admin/orders/${order.id}`);
    } catch (err) {
      toast.error(apiErrorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Panel title="Товары">
          <ItemsEditor lines={lines} onChange={setLines} />
        </Panel>
        <Panel title="Покупатель">
          <CustomerFields value={customer} onChange={setCustomer} />
        </Panel>
      </div>
      <div className="space-y-6">
        <Panel title="Сумма">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <Field label="Доставка, ₽">
              <Input type="number" min={0} value={delivery} onChange={(e) => setDelivery(Number(e.target.value) || 0)} className="h-9" />
            </Field>
            <Field label="Скидка, ₽">
              <Input type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} className="h-9" />
            </Field>
          </div>
          <Totals lines={lines} delivery={delivery} discount={discount} />
        </Panel>
        <Panel title="Служебное">
          <div className="space-y-4">
            <Field label="Откуда заказ">
              <Select items={SOURCE} value={source} onValueChange={(v) => v && setSource(v as OrderSource)}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SOURCE).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Заметка менеджера (покупатель её не видит)">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
            </Field>
          </div>
        </Panel>
        <Button type="submit" className="h-10 w-full" disabled={pending}>
          {pending && <LoaderCircle className="animate-spin" />}
          Создать заказ
        </Button>
      </div>
    </form>
  );
}
