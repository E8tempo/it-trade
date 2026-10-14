import { redirect } from "next/navigation";

import { DEFAULT_SUPPLIER } from "@/lib/admin/suppliers";

/** The old «Наценки» page: the rules are now set per supplier and price type, on the supplier's page. */
export default function PricingPage() {
  redirect(`/admin/suppliers/${DEFAULT_SUPPLIER}`);
}
