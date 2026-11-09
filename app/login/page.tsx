import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { LoginPage } from "@/components/auth/LoginPage";

export const metadata: Metadata = { robots: { index: false } };

export default function Page() { return <AuthProvider><LoginPage /></AuthProvider>; }
