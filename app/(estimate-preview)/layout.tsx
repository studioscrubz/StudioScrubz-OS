import type { Metadata } from "next";
import { AuthProvider, ProtectedWorkspace } from "@/components/auth/AuthProvider";

export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } };

export default function EstimatePreviewLayout({ children }: { children: React.ReactNode }) {
  // Do not mount the dashboard grid, sidebar, or scroll-constrained modals around printed documents.
  return <AuthProvider><ProtectedWorkspace>{children}</ProtectedWorkspace></AuthProvider>;
}
