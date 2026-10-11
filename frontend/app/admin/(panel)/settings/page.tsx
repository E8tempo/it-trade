import type { Metadata } from "next";
import { Suspense } from "react";

import { RequeuePanel, ShopSettingsForm } from "@/components/admin/settings-forms";
import { Empty, PageHeader, Panel } from "@/components/admin/ui";
import { Skeleton } from "@/components/ui/skeleton";
import type { FailedImage, ShopSettings } from "@/lib/admin/types";
import { apiServer } from "@/lib/api/server";

export const metadata: Metadata = { title: "Настройки" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Настройки"
        description="То, что меняется в процессе работы магазина. Параметры запуска (база, ключи поставщика, домен) задаются в .env на сервере."
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Suspense fallback={<Skeleton className="h-80 rounded-2xl" />}>
          <ShopSettingsContent />
        </Suspense>
        <div className="space-y-6">
          <RequeuePanel />
          <Suspense fallback={<Skeleton className="h-40 rounded-2xl" />}>
            <FailedImages />
          </Suspense>
        </div>
      </div>
    </>
  );
}

async function ShopSettingsContent() {
  const settings = await apiServer<ShopSettings>("/api/admin/settings/shop");
  return <ShopSettingsForm settings={settings} />;
}

async function FailedImages() {
  const failed = await apiServer<FailedImage[]>("/api/admin/images/failed?limit=50");
  return (
    <Panel title="Фото с ошибками">
      {failed.length === 0 ? (
        <Empty>Ошибок нет</Empty>
      ) : (
        <ul className="max-h-80 divide-y overflow-y-auto text-sm">
          {failed.map((f) => (
            <li key={f.id} className="py-2">
              <p>
                Фото {f.id} · товар {f.sku}
              </p>
              <p className="text-xs break-all text-muted-foreground">{f.error ?? "без описания"}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
