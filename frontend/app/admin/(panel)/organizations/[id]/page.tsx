import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { OrganizationEditor } from "@/components/admin/organizations/organization-editor";
import { OrgStatusBadge, PageHeader } from "@/components/admin/ui";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminOrganization } from "@/lib/admin/types";
import { ApiError, apiServer } from "@/lib/api/server";

type Props = PageProps<"/admin/organizations/[id]">;

export const metadata: Metadata = { title: "Клиент" };

async function loadOrganization(params: Props["params"]): Promise<AdminOrganization> {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  let org: AdminOrganization | null = null;
  try {
    org = await apiServer<AdminOrganization>(`/api/admin/organizations/${id}`);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  if (!org) notFound();
  return org;
}

export default function OrganizationPage({ params }: Props) {
  return (
    <>
      <Link href="/admin/organizations" className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground">
        ← Все клиенты
      </Link>
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <OrganizationContent params={params} />
      </Suspense>
    </>
  );
}

async function OrganizationContent({ params }: Pick<Props, "params">) {
  const org = await loadOrganization(params);
  return (
    <>
      <PageHeader
        title={org.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <OrgStatusBadge status={org.status} />
            <span className="tabular-nums">
              ИНН {org.inn}
              {org.kpp && ` · КПП ${org.kpp}`}
            </span>
          </span>
        }
      />
      <OrganizationEditor org={org} />
    </>
  );
}
