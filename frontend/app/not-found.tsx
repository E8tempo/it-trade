import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { NotFoundContent } from "@/components/site/not-found-content";

// Unknown URLs render outside the (shop) group, so the header and footer are added here.
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <NotFoundContent />
      </main>
      <SiteFooter />
    </>
  );
}
