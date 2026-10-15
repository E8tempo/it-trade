import type { Metadata } from "next";

import { SessionProvider } from "@/components/shop/session-provider";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = { robots: { index: false } };

/** Documents a client prints or saves as PDF: a sheet of paper, none of the site around it. */
export default function PrintLayout({ children }: LayoutProps<"/print">) {
  return (
    <SessionProvider>
      <main className="flex-1 bg-muted/60 print:bg-white">{children}</main>
      <Toaster position="top-center" richColors />
    </SessionProvider>
  );
}
