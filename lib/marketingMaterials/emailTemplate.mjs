/**
 * @typedef {object} EmailTemplateMaterial
 * @property {string} identifier
 * @property {string} title
 * @property {string} category
 * @property {string} description
 */

const signature = `Best,
StudioScrubz
747-365-6265
info@studioscrubz.com
StudioScrubz.com`;

const specializedTemplates = {
  "property-porter-services": () => `Hello,

We’re reaching out to introduce StudioScrubz Property Porter Services—reliable, ongoing support designed to help keep your property clean, monitored, and well maintained.

Our custom service plans can include routine property checks, common-area upkeep, light cleaning, photo documentation, and maintenance issue reporting based on your property’s specific needs.

Please review the attached flyer. We would be happy to discuss your property and create a service plan tailored to your community.

${signature}`,
};

/**
 * Builds fresh defaults whenever a sender selects a material. The category and
 * stable identifier are available for intentional category/material overrides;
 * all unrecognized and future materials use the metadata-driven fallback.
 *
 * @param {EmailTemplateMaterial} material
 */
export function buildMarketingMaterialEmailTemplate(material) {
  const { identifier, title, category, description } = material;
  const specialized = specializedTemplates[identifier];

  return {
    subject: `${title} from StudioScrubz`,
    messageBody: specialized?.({ title, category, description }) ?? `Hello,

We’re reaching out to introduce StudioScrubz ${title}—professional, reliable service tailored to meet your property or business needs.

${description}

Please review the attached flyer. We would be happy to learn more about your needs and create a custom service plan for your property or business.

${signature}`,
  };
}
