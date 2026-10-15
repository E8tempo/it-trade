"use client";

import { CircleHelp, CirclePause, LoaderCircle, Play, Settings2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { OverallPanel } from "@/components/admin/loading/overall";
import { AutomationsDialog, Checks, FailedPanel, QualityPanel, Stages } from "@/components/admin/loading/sections";
import { LoadingSettingsDialog } from "@/components/admin/loading/settings-panel";
import { TrialPanel } from "@/components/admin/loading/trial-panel";
import { Panel } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { apiErrorText } from "@/lib/admin/errors";
import type { Loading } from "@/lib/admin/types";
import { api } from "@/lib/api/client";

const POLL_MS = 5000;

/** Polls the loading status while the tab is visible. */
function useLoading(initial: Loading) {
  const [data, setData] = useState(initial);
  const [offline, setOffline] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setData(await api<Loading>("/api/admin/loading"));
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState === "visible") await refresh();
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [refresh]);
  return { data, offline, refresh };
}

export function LoadingDashboard({ initial }: { initial: Loading }) {
  const { data, offline, refresh } = useLoading(initial);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"settings" | "automations" | null>(null);
  const { settings } = data;
  const started = data.overview.photos_done > 0;

  async function togglePause() {
    setBusy(true);
    try {
      await api("/api/admin/settings/images", { method: "PUT", body: JSON.stringify({ ...settings, paused: !settings.paused }) });
      toast.success(settings.paused ? "Загрузка фото запущена" : "Загрузка фото на паузе");
      await refresh();
    } catch (e) {
      toast.error(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function retrySyncs() {
    try {
      const { queued } = await api<{ queued: number }>("/api/admin/loading/retry", { method: "POST" });
      toast.success(queued ? "Воркер повторит обмен в течение 30 секунд" : "Повторять нечего: обмен уже идёт или прошёл");
      await refresh();
    } catch (e) {
      toast.error(apiErrorText(e));
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Товары, цены и фото от поставщика: что готово, что идёт сейчас и когда закончится. Обновляется само каждые 5 секунд.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setDialog("automations")}>
            <CircleHelp />
            Что происходит само
          </Button>
          <Button variant="outline" onClick={() => setDialog("settings")}>
            <Settings2 />
            Настройки
          </Button>
          <Button onClick={togglePause} disabled={busy} variant={settings.paused ? "default" : "outline"}>
            {busy ? <LoaderCircle className="animate-spin" /> : settings.paused ? <Play /> : <CirclePause />}
            {settings.paused ? (started ? "Продолжить загрузку фото" : "Начать загрузку фото") : "Пауза фото"}
          </Button>
        </div>
      </div>
      <LoadingSettingsDialog data={data} onChange={refresh} open={dialog === "settings"} onOpenChange={(o) => setDialog(o ? "settings" : null)} />
      <AutomationsDialog
        perProduct={settings.per_product}
        version={data.version}
        open={dialog === "automations"}
        onOpenChange={(o) => setDialog(o ? "automations" : null)}
      />
      {offline && <p className="mb-4 text-sm text-destructive">Нет связи с API — показаны последние полученные данные.</p>}
      {settings.paused && !started && (
        <div className="mb-4 rounded-xl bg-primary/5 px-4 py-3 text-sm ring-1 ring-primary/15">
          <p className="font-medium">Первый запуск: загрузка фото ждёт вашей команды</p>
          <p className="mt-0.5 text-muted-foreground">
            Товары, цены и списки фото загружаются сами (этапы 1–4, около получаса на полном каталоге). Потом: проверки в блоке
            «Готовность» → пробная партия → «Начать загрузку фото». Пока сайт закрыт, скорость можно поднять до 4,5 фото/с.
          </p>
        </div>
      )}

      <OverallPanel data={data} />

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-6">
          <Panel title="Этапы">
            <Stages stages={data.stages} />
          </Panel>
          <TrialPanel data={data} onChange={refresh} />
        </div>
        <div className="min-w-0 space-y-6">
          <Checks checks={data.checks} onRetry={retrySyncs} />
          <FailedPanel failed={data.failed} onChange={refresh} />
          <QualityPanel quality={data.quality} />
        </div>
      </div>
    </>
  );
}
