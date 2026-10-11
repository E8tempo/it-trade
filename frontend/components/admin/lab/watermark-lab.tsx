"use client";

import { ImageUp, LoaderCircle, ZoomIn, ZoomOut } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";

import { CompareSlider } from "@/components/admin/lab/compare-slider";
import { Panel } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiErrorText } from "@/lib/admin/errors";
import { variantLabel } from "@/lib/admin/labels";
import type { LabResult, LabSample } from "@/lib/admin/types";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const VERDICT: Record<string, string> = {
  certain: "уверенно: корреляция ≥ 0,5",
  stacked: "знак наложен несколько раз",
  strong: "сильное совпадение",
  weak: "обычное совпадение",
};

const fmt = (v: number, digits = 3) => v.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function WatermarkLab({ samples }: { samples: LabSample[] }) {
  const [result, setResult] = useState<LabResult | null>(null);
  const [source, setSource] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function run(body: FormData, label: string) {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<LabResult>("/api/admin/lab/watermark", { method: "POST", body }));
      setSource(label);
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  const runFile = (file: File) => {
    const body = new FormData();
    body.set("file", file);
    run(body, `файл «${file.name}»`);
  };
  const runSample = (s: LabSample) => {
    const body = new FormData();
    body.set("image_id", String(s.image_id));
    run(body, `фото ${s.image_id} товара «${s.name}» (оригинал поставщика)`);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) runFile(file);
  };

  const groups = Object.entries(
    samples.reduce<Record<string, LabSample[]>>((acc, s) => {
      (acc[s.variant] ??= []).push(s);
      return acc;
    }, {}),
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Panel title="Своё фото">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <ImageUp className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Перетащите фото со знаком сюда или</p>
            <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
              Выберите файл
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) runFile(f);
                e.target.value = "";
              }}
            />
            <p className="text-xs text-muted-foreground">JPEG, PNG или WebP до 15 МБ. Лучше всего — оригинал с сайта поставщика.</p>
          </div>
        </Panel>
        <Panel title="Фото из каталога">
          <p className="mb-3 text-sm text-muted-foreground">
            По два обработанных фото каждого варианта знака. Берётся оригинал у поставщика, со знаком.
          </p>
          <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
            {groups.map(([variant, items]) => (
              <div key={variant}>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase">{variantLabel(variant)}</p>
                <div className="flex flex-wrap gap-2">
                  {items.map((s) => (
                    <button
                      key={s.image_id}
                      onClick={() => runSample(s)}
                      disabled={busy}
                      title={s.name}
                      className="size-16 overflow-hidden rounded-lg bg-muted p-1 ring-1 ring-foreground/10 transition hover:ring-primary disabled:opacity-50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- pre-optimised thumbnail */}
                      <img src={s.thumb} alt={s.name} className="size-full object-contain mix-blend-multiply" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Обрабатываю…
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && !busy && <Result result={result} source={source} />}
    </div>
  );
}

function Result({ result: r, source }: { result: LabResult; source: string }) {
  const d = r.detection;
  return (
    <div className="space-y-6">
      <Panel title="Итог">
        <p className="mb-4 text-sm text-muted-foreground">Источник: {source}</p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
          <Fact label="Размер" value={`${r.width} × ${r.height} px, ${r.format}`} />
          <Fact label="Цветность JPEG" value={r.chroma_subsampling === "2x2" ? "4:2:0 (половинная)" : r.chroma_subsampling === "1x1" ? "полная" : r.chroma_subsampling} />
          <Fact label="Знак" value={d ? `${variantLabel(d.template)}${d.rotated ? ", повёрнут" : ""}` : "не найден"} strong />
          <Fact label="Решение детектора" value={d ? VERDICT[d.verdict] ?? d.verdict : "все кандидаты отклонены"} />
          {d && (
            <>
              <Fact label="Корреляция" value={fmt(d.score)} />
              <Fact label="Сила знака k" value={fmt(d.strength, 2)} />
              <Fact label="Модель" value={`${d.layers} ${d.layers === 1 ? "слой" : "слоя"}, цвет ${fmt(d.color ?? 0, 1)}`} />
              <Fact label="Осталось знака k" value={fmt(d.strength_left, 3)} />
              <Fact
                label="Положение"
                value={d.moved ? `уточнено: сдвиг на (${d.moved.map((v) => (v > 0 ? `+${v}` : String(v))).join(", ")}) px` : "как нашёл детектор"}
              />
              {r.plain && (
                <Fact
                  label="Доводка ровного фона"
                  value={r.plain.max >= 1 ? `${fmt(r.plain.share * 100, 0)}% штрихов, до ${fmt(r.plain.max, 0)} ур.` : "не понадобилась"}
                />
              )}
            </>
          )}
          <Fact label="Время" value={`поиск ${r.timings_ms.detect} мс${r.timings_ms.remove != null ? `, снятие ${r.timings_ms.remove} мс` : ""}`} />
        </dl>
      </Panel>

      {r.images.cleaned && r.images.original ? (
        <Panel title="До и после" action={<DocLink href="/admin/docs/watermark-removal">как снимается знак</DocLink>}>
          <CompareSlider before={r.images.original} after={r.images.cleaned} alt="Фото" />
        </Panel>
      ) : (
        r.images.original && (
          <Panel title="Фото">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the lab */}
            <img src={r.images.original} alt="Фото" className="mx-auto max-h-[32rem] rounded-xl" />
          </Panel>
        )
      )}

      {r.images.crop_before && r.images.crop_after && (
        <CloseUps before={r.images.crop_before} after={r.images.crop_after} mask={r.images.mask} diff={r.images.diff} />
      )}

      <Panel title="Кандидаты детектора" action={<DocLink href="/admin/docs/watermark-detection">как ищется знак</DocLink>}>
        <p className="mb-3 text-sm text-muted-foreground">
          Для каждого размера знака, подходящего к размеру фото, — лучшее положение около центра. Берётся кандидат с наибольшей
          корреляцией, если он проходит одно из правил.
        </p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Шаблон</TableHead>
                <TableHead className="text-right">Позиция</TableHead>
                <TableHead className="text-right">Корреляция</TableHead>
                <TableHead className="text-right">k</TableHead>
                <TableHead className="text-right">За краем</TableHead>
                <TableHead>Решение</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.candidates.map((c, i) => (
                <TableRow key={i} className={cn(i === 0 && d && "bg-primary/5")}>
                  <TableCell>
                    {variantLabel(c.template)}
                    {c.rotated && ", повёрнут"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.x}, {c.y}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(c.score)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(c.strength, 2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(c.clipped * 100, 1)}%</TableCell>
                  <TableCell className={cn(!c.verdict && "text-muted-foreground")}>{c.verdict ? VERDICT[c.verdict] : "не проходит"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>

      {r.fit && (
        <Panel title="Подбор модели знака" action={<DocLink href="/admin/docs/watermark-removal#fit">как подбирается модель</DocLink>}>
          {r.fit.fallback ? (
            <p className="text-sm text-muted-foreground">
              Ровного фона под знаком слишком мало ({r.fit.pixels} px), цвет не подобрать: использован откалиброванный серый (
              {fmt(r.fit.grey, 1)}), число слоёв — по остаточной силе знака.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                По {r.fit.pixels.toLocaleString("ru-RU")} пикселям штрихов на ровном фоне. Ошибка — насколько восстановленные пиксели
                отличаются от фона рядом, в уровнях яркости. Более сложная модель выбирается, только если она на 15% точнее. Цвета
                отдельных слоёв могут быть любыми, но вся стопка слоёв должна давать правдоподобный серый.
              </p>
              {r.fit.switched && (
                <p className="mb-3 text-sm">
                  Модель с наименьшей ошибкой на ровном фоне оставляла знак вдоль штрихов (k = {fmt(r.fit.switched[0], 3)}), поэтому взята
                  другая: после неё k = {fmt(r.fit.switched[1], 3)}.
                </p>
              )}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Слоёв</TableHead>
                      <TableHead>Цвета слоёв</TableHead>
                      <TableHead className="text-right">Ошибка</TableHead>
                      <TableHead>Итог</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.fit.candidates.map((c, i) => (
                      <TableRow key={i} className={cn(c.chosen && "bg-primary/5 font-medium")}>
                        <TableCell>
                          {c.layers}
                          {c.layers > 1 && <span className="text-muted-foreground">{c.shared ? " (один цвет)" : " (свой цвет у слоя)"}</span>}
                        </TableCell>
                        <TableCell className="tabular-nums">{c.colours.map((v) => fmt(v, 1)).join(" / ")}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(c.error, 2)}</TableCell>
                        <TableCell className={cn(!c.chosen && "text-muted-foreground")}>
                          {c.chosen ? "выбрана" : c.plausible ? "—" : "неправдоподобный цвет"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}

function CloseUps({ before, after, mask, diff }: { before: string; after: string; mask?: string; diff?: string }) {
  const [zoom, setZoom] = useState(false);
  const img = (src: string, alt: string) => (
    <div className="overflow-auto rounded-xl bg-muted ring-1 ring-foreground/10">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the lab */}
      <img src={src} alt={alt} className={cn("block max-w-none", zoom ? "w-[200%] [image-rendering:pixelated]" : "w-full")} />
    </div>
  );
  return (
    <Panel
      title="Крупно: область знака"
      action={
        <Button variant="outline" size="sm" onClick={() => setZoom((z) => !z)}>
          {zoom ? <ZoomOut /> : <ZoomIn />}
          {zoom ? "Обычный размер" : "Увеличить ×2"}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <figure>
          {img(before, "До")}
          <figcaption className="mt-1.5 text-xs text-muted-foreground">До: как отдаёт поставщик</figcaption>
        </figure>
        <figure>
          {img(after, "После")}
          <figcaption className="mt-1.5 text-xs text-muted-foreground">После снятия</figcaption>
        </figure>
        {mask && (
          <figure>
            {img(mask, "Маска")}
            <figcaption className="mt-1.5 text-xs text-muted-foreground">Где модель ждёт знак: красным — прозрачность шаблона α</figcaption>
          </figure>
        )}
        {diff && (
          <figure>
            {img(diff, "Разница")}
            <figcaption className="mt-1.5 text-xs text-muted-foreground">
              Что изменилось: чем темнее, тем сильнее поправлен пиксель (×3). Вне знака должно быть белым
            </figcaption>
          </figure>
        )}
      </div>
    </Panel>
  );
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5", strong && "font-semibold")}>{value}</dd>
    </div>
  );
}

function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm text-primary hover:underline">
      {children}
    </Link>
  );
}
