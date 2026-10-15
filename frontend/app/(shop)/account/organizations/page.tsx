import type { Metadata } from "next";
import { Suspense } from "react";

import { AccountSkeleton, SignedIn } from "@/components/account/account-shell";
import { OrganizationsView } from "@/components/account/organizations-view";

export const metadata: Metadata = { title: "Организации" };

export default function AccountOrganizationsPage() {
  return (
    // ?add=1 opens the new organization's dialog: the query is runtime data
    <Suspense fallback={<AccountSkeleton />}>
      <SignedIn>
        <OrganizationsView />
      </SignedIn>
    </Suspense>
  );
}
