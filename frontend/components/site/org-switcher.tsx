"use client";

import { Building2, ChevronsUpDown, IdCard, LoaderCircle, Plus, Settings2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { errorMessage } from "@/components/shop/errors";
import { fullName, ORG_STATUS } from "@/components/shop/labels";
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
import { cn } from "@/lib/utils";

const PERSON = "person";

/**
 * Whom the client buys as: an approved organization of theirs or themselves as a private person. It sets the prices
 * on the whole site, the cart and the orders. Organizations being checked are listed with their status.
 * `panel`: the side panel's wide button; `icon`: the header's.
 */
export function OrgSwitcher({ variant }: { variant: "panel" | "icon" }) {
  const { user, organizations } = useSession();
  const { cart, setBuyer, syncing } = useCart();
  if (!user) return null;

  const org = cart?.organization ?? null;
  const name = fullName(user);
  const checking = organizations?.some((o) => o.status === "pending");
  const title = !cart ? "Покупатель" : org ? org.name : "Физическое лицо";
  const subtitle = !cart ? "" : org ? `ИНН ${org.inn}` : checking ? "Организация на проверке" : (name ?? user.email);
  const busy = syncing || !cart;
  const Icon = org ? Building2 : UserRound;
  // in the header it stands next to the account's own person icon
  const HeaderIcon = org ? Building2 : IdCard;

  const pick = (value: string) => {
    const id = value === PERSON ? null : Number(value);
    if (!cart || id === (org?.id ?? null)) return;
    setBuyer(id).then(
      (c) => toast.success(c.organization ? `Цены и корзина — для ${c.organization.name}` : "Цены и корзина — для физ. лица"),
      (e: unknown) => toast.error(errorMessage(e, "Не удалось сменить покупателя. Попробуйте ещё раз.")),
    );
  };

  const trigger =
    variant === "panel" ? (
      <DropdownMenuTrigger
        className="flex w-full items-center gap-3 rounded-2xl border bg-background p-2.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted/60"
        aria-label={`Покупатель: ${title}. Сменить`}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          {busy ? <LoaderCircle className="size-[18px] animate-spin" /> : <Icon className="size-[18px]" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-snug font-semibold">{title}</span>
          <span className={cn("block truncate text-xs", !org && checking ? "text-amber-700" : "text-muted-foreground")}>{subtitle}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
    ) : (
      <DropdownMenuTrigger className={cn(HEADER_ACTION, "text-primary")} aria-label={`Покупатель: ${title}. Сменить`}>
        {busy ? <LoaderCircle className="size-5 animate-spin" /> : <HeaderIcon className="size-5" />}
      </DropdownMenuTrigger>
    );

  return (
    <DropdownMenu>
      {trigger}
      <DropdownMenuContent align={variant === "panel" ? "start" : "end"} sideOffset={8} className="w-72 rounded-xl p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2.5 pt-1.5 pb-1">Покупаю как</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={cart ? (org ? String(org.id) : PERSON) : ""} onValueChange={pick}>
            {organizations?.map((o) => (
              <DropdownMenuRadioItem key={o.id} value={String(o.id)} disabled={!cart || o.status !== "approved"} className="rounded-lg px-2.5 py-2">
                <span className="min-w-0">
                  <span className="block truncate">{o.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {o.status === "approved" ? `ИНН ${o.inn}` : ORG_STATUS[o.status].label.toLowerCase()}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuRadioItem value={PERSON} disabled={!cart} className="rounded-lg px-2.5 py-2">
              <span className="min-w-0">
                <span className="block truncate">Физическое лицо</span>
                <span className="block truncate text-xs text-muted-foreground">{name ?? user.email}</span>
              </span>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {organizations?.length ? (
          <MenuLink href="/account/organizations" icon={Settings2}>
            Мои организации
          </MenuLink>
        ) : (
          <MenuLink href="/account/organizations?add=1" icon={Plus}>
            Добавить организацию
          </MenuLink>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
