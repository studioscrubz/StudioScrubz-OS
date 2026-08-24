import type { Metadata } from "next";
import { PublicAgreementPage } from "@/components/agreements/PublicAgreementPage";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Page({ params }: PageProps<"/agreement/[token]">) {
  const { token } = await params;
  return <PublicAgreementPage token={token}/>;
}
