import type { Metadata } from "next";

import { SignedIn } from "@/components/account/account-shell";
import { ProfileView } from "@/components/account/profile-view";

export const metadata: Metadata = { title: "Профиль" };

export default function AccountPage() {
  return (
    <SignedIn>
      <ProfileView />
    </SignedIn>
  );
}
