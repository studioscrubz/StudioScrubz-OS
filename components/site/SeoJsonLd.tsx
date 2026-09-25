const origin = "https://studioscrubz.com";

export function JsonLd({ data }: { data: object | object[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}

export function BreadcrumbJsonLd({
  name,
  path,
}: {
  name: string;
  path: string;
}) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: `${origin}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name,
            item: `${origin}${path}`,
          },
        ],
      }}
    />
  );
}

export function ServicePageJsonLd({
  name,
  description,
  path,
}: {
  name: string;
  description: string;
  path: string;
}) {
  const url = `${origin}${path}`;
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Service",
          "@id": `${url}#service`,
          name,
          description,
          url,
          provider: {
            "@id": `${origin}/#business`,
          },
          areaServed: [
            "Los Angeles County",
            "Greater Los Angeles",
            "San Fernando Valley",
          ],
        }}
      />
      <BreadcrumbJsonLd name={name} path={path} />
    </>
  );
}

export function FaqJsonLd({
  items,
}: {
  items: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map(([question, answer]) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: {
            "@type": "Answer",
            text: answer,
          },
        })),
      }}
    />
  );
}
