import { AppShell } from "@/components/layout/AppShell";
import { AuthProvider, ProtectedWorkspace } from "@/components/auth/AuthProvider";

export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return <AuthProvider><ProtectedWorkspace><AppShell>{children}</AppShell></ProtectedWorkspace></AuthProvider>;
}
