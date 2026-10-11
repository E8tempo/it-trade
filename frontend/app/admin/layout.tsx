import type { Metadata } from "next";

import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: { default: "Админка", template: "%s — Админка IT Trade" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-svh flex-1 flex-col bg-muted/40">
      {children}
      <Toaster position="bottom-right" richColors />
    </div>
  );
}
