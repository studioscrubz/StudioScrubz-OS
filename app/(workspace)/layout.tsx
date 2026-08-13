import { AppShell } from "@/components/layout/AppShell";

export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
