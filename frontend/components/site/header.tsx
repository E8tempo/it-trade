import { Phone } from "lucide-react";
import { connection } from "next/server";
import { Suspense } from "react";

import { AccountMenu, AccountMenuFallback } from "@/components/site/account-menu";
import { CatalogMenu } from "@/components/site/catalog-menu";
import { HeaderHeight } from "@/components/site/header-height";
import { HEADER_ACTION } from "@/components/site/header-action";
import { Logo } from "@/components/site/logo";
import { MobileMenu } from "@/components/site/mobile-menu";
import { SearchBox, SearchBoxFallback } from "@/components/site/search-box";
import { getShop } from "@/lib/catalog";

// own row on phones, next to the catalog button from md up (not stretched over wide screens)
const SEARCH_PLACEMENT = "col-span-3 row-start-2 md:col-span-1 md:col-start-3 md:row-start-1 md:w-full md:max-w-2xl";

export function SiteHeader() {
  return (
    <header data-site-header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-md supports-backdrop-filter:bg-background/80">
      <HeaderHeight />
      <div className="container-shop grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2.5 py-2.5 md:grid-cols-[auto_auto_minmax(0,1fr)_auto] md:gap-x-4 md:py-3">
        <div className="col-start-1 row-start-1 flex items-center gap-1">
          <MobileMenu className="-ml-2 md:hidden" />
          <Logo />
        </div>
        <CatalogMenu className="hidden md:col-start-2 md:row-start-1 md:block" />
        <Suspense fallback={<SearchBoxFallback className={SEARCH_PLACEMENT} />}>
          <SearchBox className={SEARCH_PLACEMENT} />
        </Suspense>
        <div className="col-start-3 row-start-1 -mr-2 flex items-center justify-self-end md:col-start-4">
          <Suspense fallback={null}>
            <HeaderPhone />
          </Suspense>
          {/* the login link returns to the current URL, which is only known in the browser */}
          <Suspense fallback={<AccountMenuFallback />}>
            <AccountMenu />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

async function HeaderPhone() {
  await connection(); // shop settings are runtime data: never fetched at build time
  const { phone } = await getShop();
  if (!phone) return null;
  return (
    <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} className={HEADER_ACTION} aria-label={`Позвонить: ${phone}`}>
      <Phone className="size-[18px] text-muted-foreground" />
      {/* the number makes room for the search box next to the catalog button (md) */}
      <span className="hidden sm:inline md:hidden lg:inline">{phone}</span>
    </a>
  );
}
