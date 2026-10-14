import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { cn } from "@/lib/utils";

import { TooltipProvider } from "@/components/ui/tooltip";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

import "./globals.css";

const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: `${SITE_NAME} — оптовые поставки для бизнеса в Крыму`, template: `%s — ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

// Before the first paint: was the visitor signed in last time? (components/shop/session-provider.tsx:
// AUTH_HINT_KEY). The `authed:` variant (globals.css) then shows a client's layout at once.
const AUTH_HINT = `try{if(localStorage.getItem("it-trade:auth")==="user")document.documentElement.dataset.auth="user"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // the script sets data-auth before React hydrates <html>
    <html lang="ru" className={cn("h-full antialiased", inter.variable, geistMono.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: AUTH_HINT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
