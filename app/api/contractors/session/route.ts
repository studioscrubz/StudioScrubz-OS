import { contractorContext, handleContractorError, noCache, requirePartner } from "@/lib/contractors/server";

export async function GET() {
  try {
    requirePartner(await contractorContext());
    return noCache({ active: true });
  } catch (error) {
    return handleContractorError(error);
  }
}
