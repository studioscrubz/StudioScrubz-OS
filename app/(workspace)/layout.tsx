import { AppShell } from "@/components/layout/AppShell";
import { AuthProvider, ProtectedWorkspace } from "@/components/auth/AuthProvider";
import { OperationalRealtimeProvider } from "@/components/realtime/OperationalRealtimeProvider";

export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return <AuthProvider><ProtectedWorkspace><OperationalRealtimeProvider><AppShell>{children}</AppShell></OperationalRealtimeProvider></ProtectedWorkspace></AuthProvider>;
}
