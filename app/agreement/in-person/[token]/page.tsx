import type { Metadata } from "next";
import { InPersonAgreementPage } from "@/components/agreements/InPersonAgreementPage";

export const metadata: Metadata = { robots: { index: false, follow: false }, title: "Sign Service Agreement | StudioScrubz" };

export default async function Page({ params }: PageProps<"/agreement/in-person/[token]">) {
  const { token } = await params;
  return <InPersonAgreementPage token={token} />;
}
