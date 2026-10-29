import { StudioScrubzLogo } from "@/components/branding/StudioScrubzLogo";
import type { CapabilityStatementModel } from "@/lib/vendorPackets/capability";

export function VendorDocumentPreview({ model }: { model: CapabilityStatementModel }) {
  return model.documentKind === "corporate-capability-statement"
    ? <CorporateCapabilityStatement model={model} />
    : <ServiceCapabilityPacket model={model} />;
}

function CorporateCapabilityStatement({ model }: { model: CapabilityStatementModel }) {
  const contact = contactLines(model);
  return <article className="vendor-document capability-statement">
    <header className="capability-header">
      <div className="capability-brand">
        <StudioScrubzLogo size={92} className="capability-logo" />
        <div>
          <p className="capability-kicker">{model.business.name}</p>
          <h1>{model.title}</h1>
          {model.business.tagline && <p className="capability-tagline">{model.business.tagline}</p>}
        </div>
      </div>
      <div className="capability-prepared">
        <span>Prepared for</span>
        <strong>{model.preparedFor}</strong>
        {model.propertyLabel && <small>{model.propertyLabel}</small>}
      </div>
    </header>

    <div className="capability-layout">
      <main>
        <DocumentSection title="Corporate Overview">
          {model.overview.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </DocumentSection>

        <DocumentSection title="Core Competencies" className="capability-competencies">
          <div className="capability-competency-grid">
            {model.coreCompetencies.map((competency) => <section className="capability-competency" key={competency.id}>
              <h3>{competency.title}</h3>
              <ul>{competency.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
            </section>)}
          </div>
        </DocumentSection>

        {model.differentiators.length > 0 && <DocumentSection title="Differentiators">
          <ul className="capability-feature-list">{model.differentiators.map((item) => <li key={item}>{item}</li>)}</ul>
        </DocumentSection>}

        {model.pastPerformance.length > 0 && <DocumentSection title="Past Performance">
          <ul className="capability-feature-list">{model.pastPerformance.map((item) => <li key={item}>{item}</li>)}</ul>
        </DocumentSection>}
      </main>

      <aside className="capability-sidebar">
        {model.corporateData.length > 0 && <DocumentSection title="Company Data">
          <dl className="capability-data">{model.corporateData.map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>
        </DocumentSection>}

        {model.serviceAreas.length > 0 && <DocumentSection title="Service Areas">
          {model.serviceAreas.map((area) => <p key={area}>{area}</p>)}
        </DocumentSection>}

        <DocumentSection title="Contact">
          {model.business.contactName && <p><strong>{model.business.contactName}</strong>{model.business.contactTitle && <><br />{model.business.contactTitle}</>}</p>}
          {contact.map((line) => <p key={line}>{line}</p>)}
        </DocumentSection>
      </aside>
    </div>

    <footer className="capability-footer"><p>{model.disclaimer}</p></footer>
  </article>;
}

function ServiceCapabilityPacket({ model }: { model: CapabilityStatementModel }) {
  const contact = contactLines(model);
  const introduction = model.overview.slice(0, 2);
  const companyBackground = model.overview.slice(2);
  return <article className="vendor-document vendor-service-packet">
    <header className="vendor-cover">
      <div className="vendor-brand-row"><StudioScrubzLogo size={82} /><div><div className="vendor-brand">{model.business.name}</div><p>Cleaning &bull; Property Services &bull; Specialty Cleaning</p>{model.business.tagline && <p>{model.business.tagline}</p>}</div></div>
      <h1>{model.title}</h1>
      <div className="vendor-prepared"><p>Prepared for:</p><h2>{model.preparedFor}</h2>{model.propertyLabel && <p><strong>Property/Project:</strong> {model.propertyLabel}</p>}</div>
      {contact.map((value) => <p key={value}>{value}</p>)}
      {introduction.map((text) => <p key={text}>{text}</p>)}
    </header>
    {companyBackground.length > 0 && <DocumentSection title={`About ${model.business.name}`}>{companyBackground.map((text) => <p key={text}>{text}</p>)}</DocumentSection>}
    <DocumentSection title="Selected Service Capabilities" className="vendor-capabilities">
      {model.coreCompetencies.map((item) => <div className="vendor-module" key={item.id}><h3>{item.title}</h3><ul>{item.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>{item.note && <p>{item.note}</p>}</div>)}
    </DocumentSection>
    {model.process.length > 0 && <DocumentSection title="How We Work" className="vendor-process"><ol>{model.process.map((step) => <li key={step.title}><h3>{step.title}</h3><p>{step.copy}</p></li>)}</ol></DocumentSection>}
    {model.differentiators.length > 0 && <DocumentSection title={`Why ${model.business.name}`} className="vendor-strengths">{model.differentiators.map((item) => {
      const [title, ...copy] = item.split(": ");
      return <div className="vendor-module" key={item}><h3>{title}</h3>{copy.length > 0 && <p>{copy.join(": ")}</p>}</div>;
    })}</DocumentSection>}
    {model.closing && <DocumentSection title="Let’s Build the Right Service Plan"><p>{model.closing}</p><p><strong>{model.business.name}</strong></p>{contact.map((value) => <p key={value}>{value}</p>)}<p>{model.disclaimer}</p></DocumentSection>}
  </article>;
}

function DocumentSection({ title, className = "", children }: { title: string; className?: string; children: React.ReactNode }) {
  return <section className={className}><h2>{title}</h2>{children}</section>;
}

function contactLines(model: CapabilityStatementModel): string[] {
  return [model.business.address, model.business.phone, model.business.email, model.business.website]
    .filter((value): value is string => Boolean(value));
}
