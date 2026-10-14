"use client";

import { Menu } from "@base-ui/react/menu";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A link inside a dropdown menu (the header's account menu, the organization switch). */
export function MenuLink({ href, icon: Icon, children }: { href: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <Menu.LinkItem
      closeOnClick
      render={<Link href={href} />}
      className={cn(
        "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-hidden select-none",
        "focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent [&_svg]:size-4 [&_svg]:shrink-0",
      )}
    >
      <Icon className="text-muted-foreground" />
      {children}
    </Menu.LinkItem>
  );
}
