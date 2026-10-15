import Link from "next/link";

import { Empty, StatusBadge } from "@/components/admin/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, PAYMENT_SHORT, SOURCE, when } from "@/lib/admin/labels";
import { PRICE_TYPE } from "@/lib/admin/suppliers";
import type { OrderListItem } from "@/lib/admin/types";

export function OrdersTable({ orders }: { orders: OrderListItem[] }) {
  if (orders.length === 0) return <Empty>Заказов нет</Empty>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>№</TableHead>
          <TableHead>Дата</TableHead>
          <TableHead>Покупатель</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead className="text-right">Товаров</TableHead>
          <TableHead className="text-right">Сумма</TableHead>
          <TableHead className="hidden md:table-cell">Источник</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((o) => (
          <TableRow key={o.id} className="relative">
            <TableCell className="font-medium tabular-nums">
              {/* the link covers the whole row */}
              <Link href={`/admin/orders/${o.id}`} className="after:absolute after:inset-0">
                {o.number}
              </Link>
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">{when(o.created_at)}</TableCell>
            <TableCell>
              <div className="font-medium">{o.customer_name}</div>
              <div className="text-xs text-muted-foreground">{o.phone}</div>
              {o.buyer_name && <div className="text-xs text-muted-foreground">{o.buyer_name}</div>}
            </TableCell>
            <TableCell>
              <StatusBadge status={o.status} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{o.items_count}</TableCell>
            <TableCell className="text-right whitespace-nowrap">
              <div className="font-medium tabular-nums">{money(o.total)}</div>
              <div className="text-xs text-muted-foreground">
                {PAYMENT_SHORT[o.payment_method]}
                {PRICE_TYPE[o.price_type].audience === "retail" && " · розница"}
              </div>
            </TableCell>
            <TableCell className="hidden text-muted-foreground md:table-cell">{SOURCE[o.source]}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
