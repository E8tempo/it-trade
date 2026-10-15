import type { Metadata } from "next";
import { Suspense } from "react";

import { QuotePrint } from "@/components/account/quotes/quote-print";

type Props = PageProps<"/print/quotes/[id]">;

export const metadata: Metadata = { title: "КП" };

// the id is runtime data: the offer itself is loaded in the browser
export default function PrintQuotePage({ params }: Props) {
  return (
    <Suspense>
      <QuoteLoader params={params} />
    </Suspense>
  );
}

async function QuoteLoader({ params }: Pick<Props, "params">) {
  const { id } = await params;
  return <QuotePrint id={id} />;
}
