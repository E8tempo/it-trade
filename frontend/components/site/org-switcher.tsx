"use client";

import { Building2, ChevronsUpDown, LoaderCircle, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { errorMessage } from "@/components/shop/errors";
import { ORG_STATUS } from "@/components/shop/labels";
import { useCart, useSession } from "@/components/shop/session-provider";
import { MenuLink } from "@/components/site/menu-link";
import { HEADER_ACTION } from "@/components/site/header-action";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Organization } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The organization the client works for: its prices on the whole site, its cart and orders. The approved ones can
 * be chosen; the others are listed with their status. `panel`: the side panel's wide button; `icon`: the header's.
 */
export function OrgSwitcher({ variant }: { variant: "panel" | "icon" }) {
  const { organizations } = useSession();
  const { cart, setBuyer, syncing } = useCart();
  if (!organizations?.length) return null;

  const current = cart?.organization ?? null;
  const shown: Pick<Organization, "name" | "inn"> | undefined = current ?? organizations[0];
  const status = current ? null : organizations[0].status;
  const pick = (value: string) => {
    const id = Number(value);
    if (id === current?.id) return;
    setBuyer(id).then(
      (c) => toast.success(`Цены и корзина — для ${c.organization.name}`),
      (e: unknown) => toast.error(errorMessage(e, "Не удалось переключить организацию. Попробуйте ещё раз.")),
    );
  };

  const trigger =
    variant === "panel" ? (
      <DropdownMenuTrigger
        className="flex w-full items-center gap-3 rounded-2xl border bg-background p-2.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted/60"
        aria-label={`Организация: ${shown.name}. Сменить`}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          {syncing ? <LoaderCircle className="size-[18px] animate-spin" /> : <Building2 className="size-[18px]" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-snug font-semibold">{shown.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{status ? ORG_STATUS[status].label : `ИНН ${shown.inn}`}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
    ) : (
      <DropdownMenuTrigger className={cn(HEADER_ACTION, "text-primary")} aria-label={`Организация: ${shown.name}. Сменить`}>
        {syncing ? <LoaderCircle className="size-5 animate-spin" /> : <Building2 className="size-5" />}
      </DropdownMenuTrigger>
    );

  return (
    <DropdownMenu>
      {trigger}
      <DropdownMenuContent align={variant === "panel" ? "start" : "end"} sideOffset={8} className="w-72 rounded-xl p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2.5 pt-1.5 pb-1">Работаю от организации</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={current ? String(current.id) : ""} onValueChange={pick}>
            {organizations.map((o) => (
              <DropdownMenuRadioItem key={o.id} value={String(o.id)} disabled={o.status !== "approved"} className="rounded-lg px-2.5 py-2">
                <span className="min-w-0">
                  <span className="block truncate">{o.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {o.status === "approved" ? `ИНН ${o.inn}` : ORG_STATUS[o.status].label.toLowerCase()}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <MenuLink href="/account/organizations" icon={Settings2}>
          Мои организации
        </MenuLink>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
