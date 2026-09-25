import { BreadcrumbJsonLd } from "@/components/site/SeoJsonLd";

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbJsonLd name="Contact StudioScrubz" path="/contact" />
      {children}
    </>
  );
}
