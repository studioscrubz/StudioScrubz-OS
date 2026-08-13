import { AuthProvider } from "@/components/auth/AuthProvider";
import { LoginPage } from "@/components/auth/LoginPage";
export default function Page() { return <AuthProvider><LoginPage /></AuthProvider>; }
