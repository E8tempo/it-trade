import type { Metadata } from "next";
import { Suspense } from "react";

import { LoadingDashboard } from "@/components/admin/loading/loading-dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import type { Loading } from "@/lib/admin/types";
import { apiServer } from "@/lib/api/server";

export const metadata: Metadata = { title: "Загрузка каталога" };

export default function LoadingPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <LoadingContent />
    </Suspense>
  );
}

async function LoadingContent() {
  const initial = await apiServer<Loading>("/api/admin/loading");
  return <LoadingDashboard initial={initial} />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-12 w-80" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}
