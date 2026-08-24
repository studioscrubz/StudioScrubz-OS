import type { Metadata } from "next";
import { PublicInvoicePage } from "@/components/invoices/PublicInvoicePage";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Page({ params, searchParams }: PageProps<"/invoice/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  return <PublicInvoicePage token={token} paymentPending={query.payment === "processing"}/>;
}
