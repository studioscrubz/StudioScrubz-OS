import type { Metadata, Viewport } from "next";
import { PwaRegistration } from "@/components/pwa/PwaRegistration";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "StudioScrubz OS",
  title: {
    default: "StudioScrubz OS",
    template: "%s | StudioScrubz OS",
  },
  description: "StudioScrubz business operations platform for estimates, walkthroughs, proposals, service agreements, jobs, scheduling, clients, employees, communications, and operations.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "StudioScrubz",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/branding/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/branding/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/branding/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#143d1a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full"><PwaRegistration />{children}</body>
    </html>
  );
}
