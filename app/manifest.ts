import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "StudioScrubz OS",
    short_name: "StudioScrubz",
    description: "StudioScrubz business operations platform for estimates, walkthroughs, proposals, service agreements, jobs, scheduling, clients, employees, communications, and operations.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f5f6f4",
    theme_color: "#143d1a",
    categories: ["business", "productivity"],
    icons: [
      { src: "/branding/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/branding/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/branding/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
