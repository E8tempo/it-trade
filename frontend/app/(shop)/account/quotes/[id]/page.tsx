import type { Metadata } from "next";
import { Suspense } from "react";

import { AccountSkeleton, SignedIn } from "@/components/account/account-shell";
import { QuoteEditor } from "@/components/account/quotes/quote-editor";

type Props = PageProps<"/account/quotes/[id]">;

// static: a title from `params` would keep the page from being prefetched
export const metadata: Metadata = { title: "КП" };

// the id is runtime data: the offer itself is loaded in the browser
export default function AccountQuotePage({ params }: Props) {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <QuoteLoader params={params} />
    </Suspense>
  );
}

async function QuoteLoader({ params }: Pick<Props, "params">) {
  const { id } = await params;
  return (
    <SignedIn>
      <QuoteEditor id={id} />
    </SignedIn>
  );
}
