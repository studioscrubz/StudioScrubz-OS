import { BreadcrumbJsonLd } from "@/components/site/SeoJsonLd";

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbJsonLd name="About StudioScrubz" path="/about" />
      {children}
    </>
  );
}
