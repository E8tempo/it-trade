import { SessionProvider } from "@/components/shop/session-provider";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { NotFoundContent } from "@/components/site/not-found-content";

// Unknown URLs render outside the (shop) group, so the header (with its account and cart
// controls) and footer are added here.
export default function NotFound() {
  return (
    <SessionProvider>
      <SiteHeader />
      <main className="flex-1">
        <NotFoundContent />
      </main>
      <SiteFooter />
    </SessionProvider>
  );
}
