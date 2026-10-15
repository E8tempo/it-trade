"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleMinus,
  CirclePause,
  Clock,
  LoaderCircle,
  RotateCcw,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { PhotoGrid } from "@/components/admin/loading/photo-grid";
import { catalogEveryLabel, stockEveryLabel } from "@/components/admin/loading/sync-timers";
import { Panel } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiErrorText } from "@/lib/admin/errors";
import { duration, when } from "@/lib/admin/labels";
import type { CheckStatus, Loading, LoadingPhoto, LoadingStage, StageStatus, SyncSettings } from "@/lib/admin/types";
import { api } from "@/lib/api/client";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const CHECK: Record<CheckStatus, { icon: LucideIcon; tone: string; label: string }> = {
  ok: { icon: CheckCircle2, tone: "text-emerald-600", label: "в порядке" },
  warn: { icon: AlertTriangle, tone: "text-amber-600", label: "стоит проверить" },
  error: { icon: XCircle, tone: "text-destructive", label: "ошибка" },
  wait: { icon: Clock, tone: "text-muted-foreground", label: "пока неизвестно" },
};

export function Checks({ checks, onRetry }: { checks: Loading["checks"]; onRetry: () => Promise<void> }) {
  const bad = checks.filter((c) => c.status === "error").length;
  return (
    <Panel
      title="Готовность"
      action={
        <span className={cn("text-sm", bad ? "text-destructive" : "text-muted-foreground")}>
          {bad ? `${bad} ${bad === 1 ? "ошибка" : bad < 5 ? "ошибки" : "ошибок"}` : "ошибок нет"}
        </span>
      }
    >
      <ul className="space-y-3">
        {checks.map((c) => {
          const s = CHECK[c.status];
          return (
            <li key={c.key} className="flex gap-3">
              <s.icon className={cn("mt-0.5 size-4 shrink-0", s.tone)} aria-label={s.label} />
              <div className="min-w-0 text-sm">
                <p className="font-medium">{c.title}</p>
                <p className="text-muted-foreground">{c.detail}</p>
                {c.hint && <p className="mt-0.5 text-xs text-muted-foreground/80">{c.hint}</p>}
                {c.action === "retry" && <RetryButton onRetry={onRetry} className="mt-2" />}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Runs the failed supplier syncs again at once instead of after the pause. */
function RetryButton({ onRetry, className }: { onRetry: () => Promise<void>; className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await onRetry();
        setBusy(false);
      }}
    >
      {busy ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
      Повторить сейчас
    </Button>
  );
}

const STAGE: Record<StageStatus, { icon: LucideIcon; tone: string; label: string }> = {
  done: { icon: CheckCircle2, tone: "text-emerald-600", label: "Готово" },
  running: { icon: LoaderCircle, tone: "text-primary", label: "Идёт" },
  waiting: { icon: Clock, tone: "text-muted-foreground", label: "В очереди" },
  paused: { icon: CirclePause, tone: "text-amber-600", label: "На паузе" },
  error: { icon: XCircle, tone: "text-destructive", label: "Ошибка" },
  off: { icon: CircleMinus, tone: "text-muted-foreground", label: "Выключено" },
};

export function Stages({ stages }: { stages: LoadingStage[] }) {
  return (
    <ol className="divide-y">
      {stages.map((st, i) => (
        <StageRow key={st.key} stage={st} n={i + 1} />
      ))}
    </ol>
  );
}

function StageRow({ stage: st, n }: { stage: LoadingStage; n: number }) {
  const s = STAGE[st.status];
  const counted = st.total != null && st.done != null;
  const pct = counted && st.total ? Math.min(100, (100 * st.done!) / st.total) : st.status === "done" ? 100 : 0;
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 py-3.5 first:pt-0 last:pb-0">
      <s.icon className={cn("mt-0.5 size-5", s.tone, st.status === "running" && "animate-spin [animation-duration:2.5s]")} aria-hidden />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="font-medium">
            <span className="mr-1.5 text-muted-foreground tabular-nums">{n}.</span>
            {st.title}
          </p>
          <p className={cn("text-sm", s.tone)}>{stageNote(st, s.label)}</p>
        </div>
        <p className="text-sm text-muted-foreground">{st.detail}</p>
        {counted && st.total! > 0 && (
          <div className="mt-2 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-2 rounded-full", st.status === "done" ? "bg-emerald-500" : "bg-primary")} style={{ width: `${pct}%` }} />
            </div>
            <span className="shrink-0 text-sm tabular-nums">
              {formatNumber(st.done!)} из {st.estimated && "≈"}
              {formatNumber(st.total!)}
              <span className="ml-1.5 text-muted-foreground">{pct < 1 && pct > 0 ? "<1" : Math.floor(pct)}%</span>
            </span>
          </div>
        )}
        {st.status === "running" && st.progress != null && (
          <div className="mt-2 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-2 rounded-full bg-primary transition-[width] duration-700" style={{ width: `${st.progress * 100}%` }} />
            </div>
            <span className="shrink-0 text-sm tabular-nums">
              {st.phase && <span className="mr-1.5 text-muted-foreground">{st.phase}</span>}
              {Math.floor(st.progress * 100)}%
            </span>
          </div>
        )}
        {st.status === "running" && st.progress == null && st.phase && <p className="mt-1 text-sm text-muted-foreground">{st.phase}</p>}
        {st.failed > 0 && <p className="mt-1 text-xs text-destructive">не скачались: {formatNumber(st.failed)}</p>}
        {st.error && (
          <p className="mt-1 text-sm break-words text-destructive">
            {st.error}
            <span className="text-muted-foreground">
              {" · "}
              {st.retry_requested ? "повтор в течение 30 секунд" : st.retry_at ? `повтор ${retryWhen(st.retry_at)}` : "повтор скоро"}
            </span>
          </p>
        )}
      </div>
    </li>
  );
}

function retryWhen(at: string): string {
  const s = (new Date(at).getTime() - Date.now()) / 1000;
  return s <= 30 ? "в течение 30 секунд" : `через ${duration(s)}`;
}

function stageNote(st: LoadingStage, label: string): string {
  const eta = st.eta_seconds != null ? `≈ ${duration(st.eta_seconds)}` : null;
  if (st.status === "done") return st.last_success_at ? `${label}, ${when(st.last_success_at)}` : label;
  if (st.status === "running") return eta ? `${label}, осталось ${eta}` : label;
  if (st.status === "waiting") return eta ? `${label}, закончится через ${eta}` : label;
  if (st.status === "paused") return eta ? `${label}; после запуска ${eta}` : label;
  return label;
}

export function QualityPanel({ quality }: { quality: Loading["quality"] }) {
  const [shown, setShown] = useState<{ kind: "left" | "no_mark"; photos: LoadingPhoto[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function show(kind: "left" | "no_mark") {
    if (shown?.kind === kind) return setShown(null);
    setBusy(kind);
    try {
      setShown({ kind, photos: await api<LoadingPhoto[]>(`/api/admin/loading/photos?kind=${kind}&limit=120`) });
    } catch (e) {
      toast.error(apiErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  const rows = [
    {
      kind: "left" as const,
      label: "Остался заметный след знака",
      n: quality.visible_left,
      hint: `Остаток больше ${quality.left_threshold}: буквы могут быть видны. Худшие — первыми.`,
    },
    {
      kind: "no_mark" as const,
      label: "Знак не найден",
      n: quality.no_mark,
      hint: "Обычно на фото знака и правда нет, но почти чёрный знак на чёрном товаре детектор иногда пропускает.",
    },
  ];
  return (
    <Panel title="Качество фото">
      <p className="mb-4 text-sm text-muted-foreground">
        После снятия знака у каждого фото измеряется, сколько знака осталось; проверено {formatNumber(quality.checked)} фото. Клик по
        фото открывает его в лаборатории — с оригиналом и сравнением до/после.
      </p>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.kind} className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 text-sm">
              <p>
                <span className="font-medium">{r.label}:</span> <span className="tabular-nums">{formatNumber(r.n)}</span>
              </p>
              <p className="text-xs text-muted-foreground">{r.hint}</p>
            </div>
            <Button variant="outline" size="sm" disabled={!r.n || busy !== null} onClick={() => show(r.kind)}>
              {busy === r.kind && <LoaderCircle className="animate-spin" />}
              {shown?.kind === r.kind ? "Скрыть" : "Показать"}
            </Button>
          </li>
        ))}
      </ul>
      {shown && (
        <div className="mt-5">
          <PhotoGrid photos={shown.photos} threshold={quality.left_threshold} />
        </div>
      )}
    </Panel>
  );
}

export function FailedPanel({ failed, onChange }: { failed: Loading["failed"]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    try {
      const { queued } = await api<{ queued: number }>("/api/admin/images/retry-failed", { method: "POST" });
      toast.success(`Снова в очереди: ${formatNumber(queued)} фото`);
      onChange();
    } catch (e) {
      toast.error(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Фото, которые не скачались"
      action={
        <Button variant="outline" size="sm" onClick={retry} disabled={busy || !failed.total}>
          {busy ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
          Повторить
        </Button>
      }
    >
      {failed.total === 0 ? (
        <p className="text-sm text-muted-foreground">Таких нет.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {formatNumber(failed.total)} фото после трёх попыток. Если не скачалось главное фото, главным становится следующее.
          </p>
          <ul className="space-y-1.5 text-sm">
            {failed.reasons.map((r) => (
              <li key={r.reason} className="flex justify-between gap-3">
                <span className="min-w-0 break-words">{r.reason}</span>
                <span className="shrink-0 tabular-nums">{formatNumber(r.count)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

export function AutomationsDialog({
  perProduct,
  version,
  sync,
  open,
  onOpenChange,
}: {
  perProduct: number;
  version: number;
  sync: SyncSettings;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const items = [
    "Сначала главные фото всех товаров в наличии, потом вторые, третьи и так далее — товары появляются в каталоге с фото как можно раньше.",
    `У товара грузятся и показываются только первые ${perProduct} фото: главное первым, дальше в порядке поставщика.`,
    "Фото, которое открыли на сайте раньше, чем до него дошла очередь, обрабатывается сразу — на долю загрузки, которую не берёт воркер.",
    `Когда выходит новая версия обработки (сейчас ${version}), фото старых версий обрабатываются заново после новых фото. До замены на сайте видна старая версия.`,
    "Если поставщик недоступен, фото остаются в очереди, а воркер ждёт минуту. Если у поставщика нет файла, фото помечается ошибкой.",
    `Списки фото товаров в наличии перечитываются раз в 14 дней, цены и наличие — ${stockEveryLabel(sync.stock_every_min)}, каталог — ${catalogEveryLabel(sync)} (меняется в настройках).`,
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto p-5 sm:max-w-xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Что происходит само</DialogTitle>
          <DialogDescription>
            Подробно — в статье{" "}
            <Link href="/admin/docs/catalog-loading" className="text-primary">
              «Загрузка каталога»
            </Link>
            .
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
