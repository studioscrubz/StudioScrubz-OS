import type { MetadataRoute } from "next";
const routes = ["", "/residential", "/commercial", "/post-construction", "/pressure-washing", "/about", "/contact"];
export default function sitemap(): MetadataRoute.Sitemap { return routes.map((route) => ({ url: `https://studioscrubz.com${route || "/"}`, lastModified: new Date(), changeFrequency: route ? "monthly" : "weekly", priority: route ? 0.8 : 1 })); }
