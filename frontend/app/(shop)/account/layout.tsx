import type { Metadata } from "next";
import { Suspense } from "react";

import { AccountGate, AccountTabs, AccountTabsFallback } from "@/components/account/account-shell";

export const metadata: Metadata = { title: "Личный кабинет", robots: { index: false } };

// Private pages: a static shell, the customer's data is loaded in the browser.
export default function AccountLayout({ children }: LayoutProps<"/account">) {
  return (
    <div className="container-shop pt-5 sm:pt-8">
      <AccountGate
        tabs={
          <Suspense fallback={<AccountTabsFallback />}>
            <AccountTabs />
          </Suspense>
        }
      >
        {children}
      </AccountGate>
    </div>
  );
}
