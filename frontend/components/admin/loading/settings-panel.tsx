"use client";

import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Field } from "@/components/admin/orders/order-fields";
import { Panel } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiErrorText } from "@/lib/admin/errors";
import type { ImageSettings, Loading } from "@/lib/admin/types";
import { api } from "@/lib/api/client";

const num = (v: number) => v.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

/** Photo loading settings; the pause is a separate button in the page header. */
export function LoadingSettings({ data, onChange }: { data: Loading; onChange: () => void }) {
  const saved = data.settings;
  const [value, setValue] = useState<ImageSettings>(saved);
  const [busy, setBusy] = useState(false);
  const fields = ["per_product", "download_rps", "gallery", "reprocess"] as const;
  const dirty = fields.some((k) => value[k] !== saved[k]);
  const { download_rps_max: max, supplier_rps: total, web_concurrency: processes } = data.limits;
  const rps = Math.min(max, Math.max(0.5, value.download_rps || 0.5));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      // the pause stays as it is now on the server
      const body = { ...value, download_rps: rps, paused: saved.paused };
      setValue(await api<ImageSettings>("/api/admin/settings/images", { method: "PUT", body: JSON.stringify(body) }));
      toast.success("Сохранено. Воркер подхватит настройки в течение минуты");
      onChange();
    } catch (err) {
      toast.error(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Настройки загрузки фото">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Фото на товар">
          <Input
            type="number"
            min={1}
            max={50}
            value={value.per_product}
            onChange={(e) => setValue({ ...value, per_product: Math.max(1, Math.min(50, Math.round(Number(e.target.value) || 1))) })}
            className="h-9 w-24"
          />
          <span className="mt-1.5 block text-sm text-muted-foreground">
            Грузятся и показываются на сайте первые N фото товара, главное — первым. Если увеличить, догрузятся только недостающие.
          </span>
        </Field>
        <Field label="Скорость загрузки, фото в секунду">
          <Input
            type="number"
            min={0.5}
            max={max}
            step={0.25}
            value={value.download_rps}
            onChange={(e) => setValue({ ...value, download_rps: Number(e.target.value) })}
            className="h-9 w-24"
          />
          <span className="mt-1.5 block text-sm text-muted-foreground">
            Поставщик даёт {num(total)} фото/с на всех. Что не берёт воркер, остаётся сайту: сейчас {num(total - rps)} фото/с на{" "}
            {processes} {processes === 1 ? "процесс" : "процесса"} API — для фото, которые открыли раньше, чем до них дошла очередь.
            Пока сайт закрыт, можно ставить до {num(max)}.
          </span>
        </Field>
        <label className="flex items-start gap-3">
          <Switch checked={value.gallery} onCheckedChange={(v) => setValue({ ...value, gallery: v })} className="mt-0.5" />
          <span className="text-sm">
            <span className="font-medium">Остальные фото — заранее</span>
            <span className="block text-muted-foreground">После всех главных. Если выключить — при первом открытии товара, секунда-две на фото.</span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <Switch checked={value.reprocess} onCheckedChange={(v) => setValue({ ...value, reprocess: v })} className="mt-0.5" />
          <span className="text-sm">
            <span className="font-medium">Переобрабатывать фото старых версий</span>
            <span className="block text-muted-foreground">
              Когда выходит новая версия обработки — после новых фото. До замены на сайте видна старая версия.
            </span>
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
