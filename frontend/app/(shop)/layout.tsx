import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";

export default function ShopLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
