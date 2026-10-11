import Link from "next/link";
import { cn } from "@/lib/utils";

import { SITE_NAME } from "@/lib/site";

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("flex shrink-0 items-center gap-2 rounded-lg font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}
    >
      <span className="grid size-8 place-items-center rounded-[10px] bg-primary text-[13px] font-bold text-primary-foreground">
        IT
      </span>
      <span className="text-[17px]">{SITE_NAME}</span>
    </Link>
  );
}
