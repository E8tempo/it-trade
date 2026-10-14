import Link from "next/link";

import { Empty, OrgStatusBadge } from "@/components/admin/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { when } from "@/lib/admin/labels";
import type { OrganizationListItem } from "@/lib/admin/types";

export function OrganizationsTable({ organizations }: { organizations: OrganizationListItem[] }) {
  if (organizations.length === 0) return <Empty>Организаций нет</Empty>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Организация</TableHead>
          <TableHead>Руководитель</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead className="text-right">Договоры</TableHead>
          <TableHead className="hidden md:table-cell">Добавлена</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {organizations.map((o) => (
          <TableRow key={o.id} className="relative">
            <TableCell>
              {/* the link covers the whole row */}
              <Link href={`/admin/organizations/${o.id}`} className="font-medium after:absolute after:inset-0">
                {o.name}
              </Link>
              <div className="text-xs text-muted-foreground tabular-nums">
                ИНН {o.inn}
                {o.kpp && ` · КПП ${o.kpp}`}
              </div>
            </TableCell>
            <TableCell>
              {o.owner ? (
                <>
                  <div>{o.owner.name || o.owner.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {[o.owner.name && o.owner.email, o.owner.phone, o.members > 1 && `ещё ${o.members - 1} сотр.`].filter(Boolean).join(" · ")}
                  </div>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              <OrgStatusBadge status={o.status} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{o.contracts || "—"}</TableCell>
            <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{when(o.created_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
