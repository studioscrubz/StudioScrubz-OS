export const contractorPropertyTypes = ["Residential", "Commercial"] as const;
export type ContractorPropertyType = (typeof contractorPropertyTypes)[number];

export const contractorPropertyConditions = ["Light", "Average", "Heavy", "Extreme", "Unknown"] as const;

const commonScope = ["Bathrooms and restrooms", "Floors", "Dusting and surface cleaning", "Interior glass and mirrors", "Trash and recycling", "Other"];

export const contractorScopeOptions: Record<ContractorPropertyType, string[]> = {
 Residential: ["Kitchen", "Bedrooms", "Living and dining areas", "Hallways and stairs", "Baseboards, doors and trim", ...commonScope],
 Commercial: ["Offices and workstations", "Breakrooms and kitchens", "Lobbies and reception", "Common areas and corridors", "Stairs and elevators", ...commonScope],
};

export type ContractorJobOptions = {
 services: Array<{name:string;division:ContractorPropertyType;addons:string[]}>;
};

export const editableContractorRequestStatuses = ["New Opportunity", "Information Requested", "Negotiating", "Awaiting Approval"];

export type ContractorRequestOptions = {
 scopeItems: string[];
 scopeDetails: string | null;
 addons: string[];
};
