import { ArrowRight, Calculator, ImageOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PriceCalculator } from "@/components/admin/pricing/price-calculator";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminCategory } from "@/lib/admin/types";
import { apiServer } from "@/lib/api/server";

export const metadata: Metadata = { title: "Лаборатория" };

export default function LabPage() {
  return (
    <>
      <PageHeader
        title="Лаборатория"
        description="Здесь можно проверить алгоритмы магазина на своих данных и посмотреть, как они принимают решения. Подробные объяснения с формулами — в разделе «Как это работает»."
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Link
          href="/admin/lab/watermark"
          className="group flex flex-col gap-3 rounded-2xl bg-background p-5 ring-1 ring-foreground/10 transition hover:ring-primary/40"
        >
          <ImageOff className="size-6 text-primary" />
          <div>
            <h2 className="font-semibold">Снятие водяного знака</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Загрузите фото поставщика или выберите из каталога: детектор, подбор модели, до/после, маска и карта изменений.
            </p>
          </div>
          <span className="mt-auto inline-flex items-center gap-1 text-sm text-primary">
            Открыть <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
        <Panel>
          <div className="mb-4 flex items-center gap-3">
            <Calculator className="size-6 text-primary" />
            <div>
              <h2 className="font-semibold">Калькулятор цены</h2>
              <p className="text-sm text-muted-foreground">Любая из четырёх цен по сохранённым правилам поставщика, шаг за шагом.</p>
            </div>
          </div>
          <Suspense fallback={<Skeleton className="h-40" />}>
            <SavedRulesCalculator />
          </Suspense>
        </Panel>
      </div>
    </>
  );
}

async function SavedRulesCalculator() {
  const categories = await apiServer<AdminCategory[]>("/api/admin/categories");
  return <PriceCalculator categories={categories} />;
}
