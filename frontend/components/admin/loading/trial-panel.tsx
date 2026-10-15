"use client";

import { Eye, FlaskConical, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PhotosDialog } from "@/components/admin/loading/sections";
import { Card } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiErrorText } from "@/lib/admin/errors";
import { duration, when } from "@/lib/admin/labels";
import type { Loading } from "@/lib/admin/types";
import { api } from "@/lib/api/client";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const SIZES = { "100": "100 фото", "200": "200 фото", "500": "500 фото" };
const num = (v: number, digits = 1) => v.toLocaleString("ru-RU", { maximumFractionDigits: digits });

export function TrialPanel({ data, onChange }: { data: Loading; onChange: () => void }) {
  const { trial, settings, quality } = data;
  const [count, setCount] = useState("200");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState(false);
  const active = trial?.status === "queued" || trial?.status === "running";

  async function start() {
    setBusy(true);
    try {
      await api("/api/admin/loading/trial", { method: "POST", body: JSON.stringify({ count: Number(count) }) });
      onChange();
    } catch (e) {
      toast.error(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  // the full load at the speed the trial showed: downloads, or the CPU if it is slower
  const stages = Object.fromEntries(data.stages.map((s) => [s.key, s]));
  const rate = trial?.capacity ? Math.min(settings.download_rps, trial.capacity) : null;
  const left = (key: string) => Math.max(0, (stages[key]?.total ?? 0) - (stages[key]?.done ?? 0));

  return (
    <Card
      title="Пробная партия"
      description="Случайные главные фото товаров в наличии, по-настоящему: сразу попадут на сайт. Работает и на паузе. Видно, всё ли в порядке и сколько займёт вся загрузка."
      action={
        <>
          <Select items={SIZES} value={count} onValueChange={(v) => v && setCount(v)} disabled={active}>
            <SelectTrigger className="h-9 w-32" aria-label="Размер партии">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SIZES).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={start} disabled={busy || active}>
            {active || busy ? <LoaderCircle className="animate-spin" /> : <FlaskConical />}
            {active ? "Идёт…" : trial ? "Ещё одну" : "Запустить"}
          </Button>
        </>
      }
      bodyClassName="py-5"
      footer={
        <>
          <span className="min-w-0 flex-1 text-muted-foreground">
            {trial?.status === "done" && trial.finished_at ? `Последняя — ${when(trial.finished_at)} · ` : ""}
            {count} фото ≈ {duration(Number(count) / settings.download_rps)}
          </span>
          {trial?.status === "done" && (
            <Button variant="outline" size="sm" onClick={() => setPhotos(true)}>
              <Eye />
              Фото партии
            </Button>
          )}
        </>
      }
    >
      {!trial && <p className="text-sm text-muted-foreground">Партий ещё не было. Начните с 200 фото: это 1–2 минуты.</p>}
      {trial?.status === "queued" && (
        <p className="text-sm text-muted-foreground">Воркер возьмёт партию, как только закончит текущую пачку фото — обычно в пределах минуты.</p>
      )}
      {trial?.status === "running" && (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700"
              style={{ width: `${(100 * ((trial.done ?? 0) + (trial.failed ?? 0))) / (trial.count || trial.requested)}%` }}
            />
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground tabular-nums">
            Обработано {trial.done ?? 0} из {trial.count ?? trial.requested}
            {trial.failed ? `, не скачалось ${trial.failed}` : ""}
          </p>
        </div>
      )}
      {trial?.status === "interrupted" && <p className="text-sm text-amber-700">Прошлая партия прервалась: воркер перезапускался. Запустите новую.</p>}

      {trial?.status === "done" && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
          <Kpi label="Обработано" value={`${trial.ready ?? trial.done} из ${trial.count ?? trial.requested}`} />
          <Kpi
            label="Скорость"
            value={trial.seconds ? `${num((trial.done ?? 0) / trial.seconds, 2)} фото/с` : "—"}
            hint={`загрузка ${num(trial.download_rps ?? settings.download_rps, 2)} фото/с`}
          />
          <Kpi
            label="Процессор"
            value={trial.capacity ? `${num(trial.capacity, 1)} фото/с` : "—"}
            hint={trial.ms_median ? `успевает; ${num(trial.ms_median / 1000, 2)} с на фото × ${trial.image_workers}` : "успевает"}
            bad={!!trial.capacity && trial.capacity < 0.9 * settings.download_rps}
          />
          <Kpi label="Не скачалось" value={String(trial.failed_photos ?? trial.failed ?? 0)} bad={(trial.failed_photos ?? 0) > 0} />
          <Kpi
            label="Остался след знака"
            value={String(trial.visible_left ?? 0)}
            hint={`остаток больше ${quality.left_threshold}`}
            bad={(trial.visible_left ?? 0) > 0}
          />
          <Kpi label="Знак не найден" value={String(trial.no_mark ?? 0)} hint="бывает на фото без знака" />
          {rate && (
            <>
              <Kpi label="Главные фото" value={forecast(left("main"), rate)} hint={`осталось ${formatNumber(left("main"))}`} />
              <Kpi
                label="Все фото"
                value={forecast(left("main") + left("gallery"), rate)}
                hint={`до ${settings.per_product} на товар`}
              />
            </>
          )}
        </dl>
      )}
      <PhotosDialog
        kind={photos ? "trial" : null}
        title="Фото пробной партии"
        threshold={quality.left_threshold}
        onOpenChange={(o) => !o && setPhotos(false)}
      />
    </Card>
  );
}

function forecast(photos: number, rate: number): string {
  return photos ? `≈ ${duration(photos / rate)}` : "готово";
}

function Kpi({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 font-semibold tabular-nums", bad && "text-destructive")}>{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}
