import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { LoadingDashboard } from "@/components/admin/loading/loading-dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { hasLoading, supplierName } from "@/lib/admin/suppliers";
import type { Loading } from "@/lib/admin/types";
import { apiServer } from "@/lib/api/server";

type Props = PageProps<"/admin/suppliers/[code]/loading">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: `Загрузка каталога · ${supplierName(code) ?? "Поставщик"}` };
}

export default function SupplierLoadingPage({ params }: Props) {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <LoadingContent params={params} />
    </Suspense>
  );
}

async function LoadingContent({ params }: Pick<Props, "params">) {
  const { code } = await params;
  if (!hasLoading(code)) notFound();
  // IT Partner's loading: the only one so far (backend/app/api/admin/loading.py)
  const initial = await apiServer<Loading>("/api/admin/loading");
  return <LoadingDashboard initial={initial} />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-full max-w-3xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}
