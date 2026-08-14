import { PublicAgreementPage } from "@/components/agreements/PublicAgreementPage";

export default async function Page({ params }: PageProps<"/agreement/[token]">) {
  const { token } = await params;
  return <PublicAgreementPage token={token}/>;
}
