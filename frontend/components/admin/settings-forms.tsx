"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Field } from "@/components/admin/orders/order-fields";
import { Panel } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { apiErrorText } from "@/lib/admin/errors";
import type { ShopSettings } from "@/lib/admin/types";
import { api } from "@/lib/api/client";

const TEXT_FIELDS: [keyof ShopSettings, string, string?][] = [
  ["name", "Название магазина"],
  ["tagline", "Подзаголовок на главной"],
  ["phone", "Телефон", "+7 978 000-00-00"],
  ["email", "E-mail", "shop@example.com"],
  ["address", "Адрес магазина / пункта выдачи"],
  ["working_hours", "Часы работы", "Пн–Пт 9:00–18:00"],
];

export function ShopSettingsForm({ settings }: { settings: ShopSettings }) {
  const router = useRouter();
  const [value, setValue] = useState(settings);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(settings);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/admin/settings/shop", { method: "PUT", body: JSON.stringify(value) });
      toast.success("Настройки сохранены. На сайте они появятся в течение нескольких минут");
      router.refresh();
    } catch (err) {
      toast.error(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Магазин">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {TEXT_FIELDS.map(([key, label, placeholder]) => (
            <Field key={key} label={label}>
              <Input
                value={String(value[key] ?? "")}
                placeholder={placeholder}
                onChange={(e) => setValue({ ...value, [key]: e.target.value })}
                className="h-9"
              />
            </Field>
          ))}
        </div>
        <label className="flex items-start gap-3">
          <Switch checked={value.show_out_of_stock} onCheckedChange={(v) => setValue({ ...value, show_out_of_stock: v })} className="mt-0.5" />
          <span className="text-sm">
            <span className="font-medium">Показывать товары не в наличии</span>
            <span className="block text-muted-foreground">В каталоге и поиске, после товаров в наличии.</span>
          </span>
        </label>
        <Button type="submit" disabled={busy || !dirty}>
          {busy && <LoaderCircle className="animate-spin" />}
          Сохранить
        </Button>
      </form>
    </Panel>
  );
}

const VARIANTS = { all: "Все фото", big: "Большой знак", mid: "Средний знак", small: "Малый знак", tiny: "Крошечный знак" };

export function RequeuePanel() {
  const [variant, setVariant] = useState("all");
  const [busy, setBusy] = useState(false);

  async function requeue() {
    setBusy(true);
    try {
      const { queued } = await api<{ queued: number }>("/api/admin/images/requeue", {
        method: "POST",
        body: JSON.stringify({ variant: variant === "all" ? null : variant }),
      });
      toast.success(`В очереди на переобработку: ${queued.toLocaleString("ru-RU")} фото`);
    } catch (e) {
      toast.error(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Переобработка фото">
      <p className="mb-4 text-sm text-muted-foreground">
        Нужна после перекалибровки шаблонов знака или обновления алгоритма. Фото обрабатываются заново в фоне (около 3 в секунду);
        пока новая версия не готова, на сайте видна старая.
      </p>
      <div className="flex flex-wrap gap-2">
        <Select items={VARIANTS} value={variant} onValueChange={(v) => v && setVariant(v)}>
          <SelectTrigger className="h-9 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(VARIANTS).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={requeue} disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          Переобработать
        </Button>
      </div>
    </Panel>
  );
}
