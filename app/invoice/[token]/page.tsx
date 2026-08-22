import { PublicInvoicePage } from "@/components/invoices/PublicInvoicePage";

export default async function Page({ params, searchParams }: PageProps<"/invoice/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  return <PublicInvoicePage token={token} paymentPending={query.payment === "processing"}/>;
}
