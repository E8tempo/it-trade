import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SupplierTabs } from "@/components/admin/supplier-tabs";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SUPPLIERS, supplierSections } from "@/lib/admin/suppliers";

type Props = LayoutProps<"/admin/suppliers/[code]">;

/** A supplier: its name, site and sections (prices, catalog loading); every supplier delivers its catalog its own way. */
export default function SupplierLayout({ children, params }: Props) {
  return (
    <>
      <Suspense fallback={<HeaderSkeleton />}>
        <SupplierHeader params={params} />
      </Suspense>
      {children}
    </>
  );
}

async function SupplierHeader({ params }: Pick<Props, "params">) {
  const { code } = await params;
  const supplier = SUPPLIERS.find((s) => s.code === code);
  if (!supplier) notFound();
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Поставщик</p>
          <h1 className="text-2xl font-semibold tracking-tight">{supplier.name}</h1>
        </div>
        <a href={supplier.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
          <ExternalLink />
          {supplier.url.replace(/^https?:\/\//, "")}
        </a>
      </div>
      <SupplierTabs sections={supplierSections(supplier.code)} />
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="mb-6 space-y-4">
      <Skeleton className="h-12 w-60" />
      <Skeleton className="h-9 w-full max-w-md" />
    </div>
  );
}
