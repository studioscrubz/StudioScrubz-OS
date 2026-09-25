import { BreadcrumbJsonLd } from "@/components/site/SeoJsonLd";

export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbJsonLd name="Careers" path="/careers" />
      {children}
    </>
  );
}
