import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "StudioScrubz OS",
    template: "%s | StudioScrubz OS",
  },
  description: "StudioScrubz business operations workspace.",
  icons: {
    icon: "/branding/studioscrubz-logo.png",
    apple: "/branding/studioscrubz-logo.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
