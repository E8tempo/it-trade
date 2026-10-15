import type { Metadata } from "next";

import { SignedIn } from "@/components/account/account-shell";
import { QuotesList } from "@/components/account/quotes/quotes-list";

export const metadata: Metadata = { title: "КП для клиентов" };

export default function AccountQuotesPage() {
  return (
    <SignedIn>
      <QuotesList />
    </SignedIn>
  );
}
