"use client";

import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { catalogEveryLabel, stockEveryLabel } from "@/components/admin/loading/sync-timers";
import { Field } from "@/components/admin/orders/order-fields";
import { RequeueSection } from "@/components/admin/settings-forms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { apiErrorText } from "@/lib/admin/errors";
import type { ImageSettings, Loading, SyncSettings } from "@/lib/admin/types";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const num = (v: number) => v.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

const DIALOG = "max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto p-5 sm:max-w-3xl sm:p-6";

// the supplier allows prices and stock 10 times an hour: not more often than every 6 minutes
const STOCK_MINUTES = [10, 15, 20, 30, 45, 60, 120, 180, 360, 720, 1440];
// divisors of 24 (the backend accepts only these): the catalog runs at the same hours every day
const CATALOG_HOURS = [1, 2, 3, 4, 6, 8, 12, 24];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const catalogEvery = (n: number) => (n === 24 ? "раз в сутки" : n === 1 ? "каждый час" : `каждые ${n} ч`);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Photo loading and supplier sync settings, and the requeue of processed photos; the pause is a separate
 * button in the page header. */
export function LoadingSettingsDialog({
  data,
  onChange,
  open,
  onOpenChange,
}: {
  data: Loading;
  onChange: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Настройки загрузки каталога</DialogTitle>
          <DialogDescription>Воркер подхватывает их в течение минуты.</DialogDescription>
        </DialogHeader>
        {/* mounted while the dialog is open: it starts from the saved settings every time */}
        <SettingsForm data={data} onSaved={() => (onChange(), onOpenChange(false))} />
        <div className="border-t pt-5">
          <RequeueSection />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({ data, onSaved }: { data: Loading; onSaved: () => void }) {
  const [images, setImages] = useState<ImageSettings>(data.settings);
  const [sync, setSync] = useState<SyncSettings>(data.sync);
  const [busy, setBusy] = useState(false);
  const imagesDirty = (["per_product", "download_rps", "gallery", "reprocess"] as const).some((k) => images[k] !== data.settings[k]);
  const syncDirty = (["stock_every_min", "catalog_every_hours", "catalog_hour"] as const).some((k) => sync[k] !== data.sync[k]);
  const { download_rps_max: max, supplier_rps: total, web_concurrency: processes } = data.limits;
  const rps = Math.min(max, Math.max(0.5, images.download_rps || 0.5));

  // a saved interval that is not in the list (set through the API) stays selectable
  const stockItems = Object.fromEntries(
    [...new Set([...STOCK_MINUTES, data.sync.stock_every_min])].sort((a, b) => a - b).map((m) => [String(m), stockEveryLabel(m)]),
  );
  const catalogItems = Object.fromEntries(CATALOG_HOURS.map((n) => [String(n), catalogEvery(n)]));
  const hourItems = Object.fromEntries(HOURS.map((h) => [String(h), hourLabel(h)]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (imagesDirty) {
        // the pause stays as it is now on the server
        const body = { ...images, download_rps: rps, paused: data.settings.paused };
        await api<ImageSettings>("/api/admin/settings/images", { method: "PUT", body: JSON.stringify(body) });
      }
      if (syncDirty) await api<SyncSettings>("/api/admin/settings/sync", { method: "PUT", body: JSON.stringify(sync) });
      toast.success("Сохранено. Воркер подхватит настройки в течение минуты");
      onSaved();
    } catch (err) {
      toast.error(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <section>
        <h3 className="mb-3 font-medium">Обмен с поставщиком</h3>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
          <Field label="Цены и наличие">
            <Pick items={stockItems} value={sync.stock_every_min} onChange={(v) => setSync({ ...sync, stock_every_min: v })} />
            <Hint>Поставщик разрешает 10 запросов в час, поэтому не чаще раза в 6 минут. Вместе с ценами пересчитываются цены сайта.</Hint>
          </Field>
          <Field label="Каталог и категории">
            <div className="flex gap-2">
              <Pick
                items={catalogItems}
                value={sync.catalog_every_hours}
                onChange={(v) => setSync({ ...sync, catalog_every_hours: v })}
                className="flex-1"
              />
              <Pick
                items={hourItems}
                value={sync.catalog_hour}
                onChange={(v) => setSync({ ...sync, catalog_hour: v })}
                className="w-28"
                label={sync.catalog_every_hours === 24 ? "Во сколько" : "Начиная с"}
              />
            </div>
            <Hint>
              Сейчас: {catalogEveryLabel(sync)}. Поставщик обновляет каталог ночью, файл ~125 МБ; скачивать его можно 2 раза в час.
            </Hint>
          </Field>
        </div>
      </section>

      <section className="border-t pt-5">
        <h3 className="mb-3 font-medium">Фото</h3>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
          <Field label="Фото на товар">
            <Input
              type="number"
              min={1}
              max={50}
              value={images.per_product}
              onChange={(e) => setImages({ ...images, per_product: Math.max(1, Math.min(50, Math.round(Number(e.target.value) || 1))) })}
              className="h-9 w-24"
            />
            <Hint>Грузятся и показываются на сайте первые N фото товара, главное — первым. Если увеличить, догрузятся только недостающие.</Hint>
          </Field>
          <Field label="Скорость загрузки, фото в секунду">
            <Input
              type="number"
              min={0.5}
              max={max}
              step={0.25}
              value={images.download_rps}
              onChange={(e) => setImages({ ...images, download_rps: Number(e.target.value) })}
              className="h-9 w-24"
            />
            <Hint>
              Поставщик даёт {num(total)} фото/с на всех. Что не берёт воркер, остаётся сайту: сейчас {num(total - rps)} фото/с на{" "}
              {processes} {processes === 1 ? "процесс" : "процесса"} API. Пока сайт закрыт, можно ставить до {num(max)}.
            </Hint>
          </Field>
          <Toggle
            checked={images.gallery}
            onChange={(v) => setImages({ ...images, gallery: v })}
            title="Остальные фото — заранее"
            hint="После всех главных. Если выключить — при первом открытии товара, секунда-две на фото."
          />
          <Toggle
            checked={images.reprocess}
            onChange={(v) => setImages({ ...images, reprocess: v })}
            title="Переобрабатывать фото старых версий"
            hint="Когда выходит новая версия обработки — после новых фото. До замены на сайте видна старая версия."
          />
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <DialogClose render={<Button type="button" variant="ghost" />}>Отмена</DialogClose>
        <Button type="submit" disabled={busy || !(imagesDirty || syncDirty)}>
          {busy && <LoaderCircle className="animate-spin" />}
          Сохранить
        </Button>
      </div>
    </form>
  );
}

function Pick({
  items,
  value,
  onChange,
  className,
  label,
}: {
  items: Record<string, string>;
  value: number;
  onChange: (v: number) => void;
  className?: string;
  label?: string;
}) {
  return (
    <Select items={items} value={String(value)} onValueChange={(v) => v && onChange(Number(v))}>
      <SelectTrigger className={cn("h-9 w-full", className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(items).map(([k, text]) => (
          <SelectItem key={k} value={k}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Toggle({ checked, onChange, title, hint }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint: string }) {
  return (
    <label className="flex items-start gap-3">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <span className="text-sm">
        <span className="font-medium">{title}</span>
        <span className="block text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="mt-1.5 block text-sm text-muted-foreground">{children}</span>;
}
