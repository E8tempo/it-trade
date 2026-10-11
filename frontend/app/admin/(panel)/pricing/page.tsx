import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PricingEditor } from "@/components/admin/pricing/pricing-editor";
import { PageHeader } from "@/components/admin/ui";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminCategory, PricingSettings } from "@/lib/admin/types";
import { apiServer } from "@/lib/api/server";

export const metadata: Metadata = { title: "Наценки" };

export default function PricingPage() {
  return (
    <>
      <PageHeader
        title="Наценки"
        description={
          <>
            Правила, по которым цена на сайте считается из закупочной цены поставщика. Пересчёт идёт сразу после сохранения и
            при каждом обновлении остатков. Подробно — в разделе{" "}
            <Link href="/admin/docs/pricing" className="text-primary hover:underline">
              «Как считается цена»
            </Link>
            .
          </>
        }
      />
      <Suspense fallback={<Skeleton className="h-[36rem] rounded-2xl" />}>
        <PricingContent />
      </Suspense>
    </>
  );
}

async function PricingContent() {
  const [settings, categories] = await Promise.all([
    apiServer<PricingSettings>("/api/admin/settings/pricing"),
    apiServer<AdminCategory[]>("/api/admin/categories"),
  ]);
  return <PricingEditor settings={settings} categories={categories} />;
}
