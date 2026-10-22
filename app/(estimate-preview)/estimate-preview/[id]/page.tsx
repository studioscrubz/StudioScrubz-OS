import type { Metadata } from "next";
import { StaffEstimatePreview } from "@/components/estimates/StaffEstimatePreview";

export const metadata: Metadata = { title: "Estimate Review | StudioScrubz OS", robots: { index: false, follow: false, nocache: true } };

export default async function Page({params}: PageProps<"/estimate-preview/[id]">) {
  const { id } = await params;
  return <StaffEstimatePreview estimateId={id}/>;
}
