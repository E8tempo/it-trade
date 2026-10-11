import { Suspense } from "react";

import { AdminSidebar, AdminTopbar } from "@/components/admin/nav";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/lib/admin/auth";

export default function AdminPanelLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-svh flex-1">
      <AdminSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* the session is read at request time, so everything behind the check streams in */}
        <Suspense fallback={<PanelSkeleton />}>
          <AdminGate>{children}</AdminGate>
        </Suspense>
      </div>
    </div>
  );
}

async function AdminGate({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  return (
    <>
      <AdminTopbar user={user} />
      <main className="w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
    </>
  );
}

function PanelSkeleton() {
  return (
    <>
      <div className="h-14 border-b bg-background" />
      <div className="space-y-4 px-4 py-8 sm:px-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    </>
  );
}
