import { redirect } from "next/navigation";

import { DEFAULT_SUPPLIER } from "@/lib/admin/suppliers";

/** The old address: catalog loading is a section of the supplier now (every supplier loads its own way). */
export default function LoadingPage() {
  redirect(`/admin/suppliers/${DEFAULT_SUPPLIER}/loading`);
}
