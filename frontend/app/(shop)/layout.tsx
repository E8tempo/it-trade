import { SessionProvider } from "@/components/shop/session-provider";
import { ClientSidebar } from "@/components/site/client-panel";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { Toaster } from "@/components/ui/sonner";

export default function ShopLayout({ children }: LayoutProps<"/">) {
  return (
    // the session and the cart are loaded in the browser: pages stay the same for everyone
    <SessionProvider>
      <SiteHeader />
      <div className="flex flex-1">
        {/* a client's sections, from lg up; a guest has none. The footer is in the content's column, so the
            panel stays on screen down to the very bottom of the page */}
        <ClientSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
      </div>
      <Toaster position="top-center" richColors />
    </SessionProvider>
  );
}
