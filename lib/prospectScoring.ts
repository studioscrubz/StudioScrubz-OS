export type ProspectScoreInput = {
  territory?: string | null;
  industry?: string | null;
  recurringPotential: boolean;
  verificationStatus: string;
  email?: string | null;
  phone?: string | null;
  estimatedValue?: number | null;
  discoveredAt: string;
};

export function calculateProspectScore(input: ProspectScoreInput, now = new Date()) {
  const territory = input.territory?.toLocaleLowerCase() ?? "";
  const industry = input.industry?.toLocaleLowerCase() ?? "";
  const ageDays = Math.floor((now.getTime() - new Date(input.discoveredAt).getTime()) / 86_400_000);
  const points = {
    territory: ["primary", "core", "local"].includes(territory) ? 20 : territory === "secondary" ? 10 : 0,
    industry: ["office", "property management", "medical", "restaurant", "retail"].includes(industry) ? 15 : 5,
    recurring: input.recurringPotential ? 20 : 0,
    verifiedContact: input.verificationStatus === "Verified" && Boolean(input.email || input.phone) ? 15 : 0,
    estimatedValue: (input.estimatedValue ?? 0) >= 10_000 ? 20 : (input.estimatedValue ?? 0) >= 5_000 ? 15 : (input.estimatedValue ?? 0) >= 1_000 ? 10 : 0,
    freshness: ageDays <= 30 ? 10 : ageDays <= 90 ? 5 : 0,
  };
  return {
    score: Math.min(100, Object.values(points).reduce((sum, value) => sum + value, 0)),
    explanation: `Territory ${points.territory}; industry ${points.industry}; recurring ${points.recurring}; verified contact ${points.verifiedContact}; value ${points.estimatedValue}; freshness ${points.freshness}.`,
  };
}
