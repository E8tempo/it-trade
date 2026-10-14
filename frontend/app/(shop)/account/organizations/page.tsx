import type { Metadata } from "next";

import { SignedIn } from "@/components/account/account-shell";
import { OrganizationsView } from "@/components/account/organizations-view";

export const metadata: Metadata = { title: "Организации" };

export default function AccountOrganizationsPage() {
  return (
    <SignedIn>
      <OrganizationsView />
    </SignedIn>
  );
}
