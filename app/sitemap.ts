import type { MetadataRoute } from "next";
const routes = ["", "/residential", "/commercial", "/property-management", "/property-porter-services", "/luxury-property-care", "/airbnb-cleaning", "/post-construction", "/pressure-washing", "/about", "/contact", "/careers"];
export default function sitemap(): MetadataRoute.Sitemap { return routes.map((route) => ({ url: `https://studioscrubz.com${route || "/"}`, changeFrequency: route ? "monthly" : "weekly", priority: route ? 0.8 : 1 })); }
