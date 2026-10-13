"use client";

import { FlaskConical, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PhotoGrid } from "@/components/admin/loading/photo-grid";
import { Panel } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiErrorText } from "@/lib/admin/errors";
import { duration, when } from "@/lib/admin/labels";
import type { Loading, LoadingPhoto } from "@/lib/admin/types";
import { api } from "@/lib/api/client";
import { formatNumber } from "@/lib/format";

const SIZES = { "100": "100 фото", "200": "200 фото", "500": "500 фото" };
const num = (v: number, digits = 1) => v.toLocaleString("ru-RU", { maximumFractionDigits: digits });

export function TrialPanel({ data, onChange }: { data: Loading; onChange: () => void }) {
  const { trial, settings, quality } = data;
  const [count, setCount] = useState("200");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<LoadingPhoto[] | null>(null);
  const active = trial?.status === "queued" || trial?.status === "running";

  async function start() {
    setBusy(true);
    try {
      await api("/api/admin/loading/trial", { method: "POST", body: JSON.stringify({ count: Number(count) }) });
      setPhotos(null);
      onChange();
    } catch (e) {
      toast.error(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function togglePhotos() {
    if (photos) return setPhotos(null);
    setBusy(true);
    try {
      setPhotos(await api<LoadingPhoto[]>("/api/admin/loading/photos?kind=trial&limit=500"));
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
    <Panel title="Пробная партия">
      <p className="mb-4 text-sm text-muted-foreground">
        Перед полной загрузкой: воркер скачает и обработает случайные главные фото товаров в наличии — по-настоящему, они сразу
        попадут на сайт и второй раз не грузятся. Работает и на паузе. По итогу видно, всё ли в порядке и сколько займёт вся загрузка
        на этом сервере.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Select items={SIZES} value={count} onValueChange={(v) => v && setCount(v)} disabled={active}>
          <SelectTrigger className="h-9 w-36">
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
          {active ? <LoaderCircle className="animate-spin" /> : <FlaskConical />}
          {active ? "Идёт…" : trial ? "Запустить ещё одну" : "Запустить"}
        </Button>
        <span className="text-sm text-muted-foreground">
          ≈ {duration(Number(count) / settings.download_rps)} при {num(settings.download_rps, 2)} фото/с
        </span>
      </div>

      {trial?.status === "queued" && (
        <p className="mt-4 text-sm text-muted-foreground">Воркер возьмёт партию, как только закончит текущую пачку фото — обычно в пределах минуты.</p>
      )}
      {trial?.status === "running" && (
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${(100 * ((trial.done ?? 0) + (trial.failed ?? 0))) / (trial.count || trial.requested)}%` }}
            />
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground tabular-nums">
            Обработано {trial.done ?? 0} из {trial.count ?? trial.requested}
            {trial.failed ? `, не скачалось ${trial.failed}` : ""}
          </p>
        </div>
      )}
      {trial?.status === "interrupted" && (
        <p className="mt-4 text-sm text-amber-700">Прошлая партия прервалась: воркер перезапускался. Запустите новую.</p>
      )}

      {trial?.status === "done" && (
        <div className="mt-5 space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 2xl:grid-cols-4">
            <Kpi label="Обработано" value={`${trial.ready ?? trial.done} из ${trial.count ?? trial.requested}`} hint={when(trial.finished_at)} />
            <Kpi
              label="Остался заметный след"
              value={String(trial.visible_left ?? 0)}
              hint={`остаток больше ${quality.left_threshold}`}
              bad={(trial.visible_left ?? 0) > 0}
            />
            <Kpi label="Знак не найден" value={String(trial.no_mark ?? 0)} hint="бывает на фото без знака" />
            <Kpi label="Не скачалось" value={String(trial.failed_photos ?? trial.failed ?? 0)} bad={(trial.failed_photos ?? 0) > 0} />
            <Kpi
              label="Скорость партии"
              value={trial.seconds ? `${num((trial.done ?? 0) / trial.seconds, 2)} фото/с` : "—"}
              hint={`загрузка была ${num(trial.download_rps ?? settings.download_rps, 2)} фото/с`}
            />
            <Kpi
              label="Процессор успевает"
              value={trial.capacity ? `${num(trial.capacity, 1)} фото/с` : "—"}
              hint={trial.ms_median ? `${num(trial.ms_median / 1000, 2)} с на фото × ${trial.image_workers} проц.` : undefined}
              bad={!!trial.capacity && trial.capacity < 0.9 * settings.download_rps}
            />
            {rate && (
              <>
                <Kpi label="Главные фото займут" value={forecast(left("main"), rate)} hint={`осталось ${formatNumber(left("main"))}`} />
                <Kpi
                  label="Все фото займут"
                  value={forecast(left("main") + left("gallery"), rate)}
                  hint={`осталось ${formatNumber(left("main") + left("gallery"))}, до ${settings.per_product} на товар`}
                />
              </>
            )}
          </dl>
          <Button variant="outline" size="sm" onClick={togglePhotos} disabled={busy}>
            {busy && <LoaderCircle className="animate-spin" />}
            {photos ? "Скрыть фото партии" : "Посмотреть фото партии"}
          </Button>
          {photos && <PhotoGrid photos={photos} threshold={quality.left_threshold} />}
        </div>
      )}
    </Panel>
  );
}

function forecast(photos: number, rate: number): string {
  return photos ? `≈ ${duration(photos / rate)}` : "уже загружены";
}

function Kpi({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={bad ? "mt-0.5 font-semibold text-destructive tabular-nums" : "mt-0.5 font-semibold tabular-nums"}>{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}
