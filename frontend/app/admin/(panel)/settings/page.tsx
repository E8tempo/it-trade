import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ShopSettingsForm } from "@/components/admin/settings-forms";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Skeleton } from "@/components/ui/skeleton";
import type { ShopSettings } from "@/lib/admin/types";
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
        <Panel title="Фото товаров">
          <p className="text-sm text-muted-foreground">
            Сколько фото грузить на товар, скорость загрузки, пауза, переобработка и фото с ошибками — на странице{" "}
            <Link href="/admin/loading" className="text-primary hover:underline">
              «Загрузка каталога»
            </Link>
            .
          </p>
        </Panel>
      </div>
    </>
  );
}

async function ShopSettingsContent() {
  const settings = await apiServer<ShopSettings>("/api/admin/settings/shop");
  return <ShopSettingsForm settings={settings} />;
}
