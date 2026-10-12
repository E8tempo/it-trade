import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { WatermarkLab } from "@/components/admin/lab/watermark-lab";
import { PageHeader } from "@/components/admin/ui";
import { Skeleton } from "@/components/ui/skeleton";
import type { LabSampleGroup } from "@/lib/admin/types";
import { apiServer } from "@/lib/api/server";

export const metadata: Metadata = { title: "Лаборатория: водяной знак" };

export default function WatermarkLabPage() {
  return (
    <>
      <Link href="/admin/lab" className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground">
        ← Лаборатория
      </Link>
      <PageHeader
        title="Снятие водяного знака"
        description={
          <>
            Тот же код, что обрабатывает фото каталога: поиск знака, подбор модели и снятие — с каждым шагом на экране. Ничего не
            сохраняется. Теория — в разделе{" "}
            <Link href="/admin/docs/watermark-model" className="text-primary hover:underline">
              «Как это работает»
            </Link>
            .
          </>
        }
      />
      <Suspense fallback={<Skeleton className="h-80 rounded-2xl" />}>
        <LabContent />
      </Suspense>
    </>
  );
}

async function LabContent() {
  const samples = await apiServer<LabSampleGroup[]>("/api/admin/lab/watermark/samples");
  return <WatermarkLab samples={samples} />;
}
