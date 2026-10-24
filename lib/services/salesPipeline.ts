import { getSupabaseClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/services/auth";

/**
 * Sales must use role-scoped financial projections rather than direct table SELECT *.
 * The database verifies auth.uid() and Sales role on every RPC invocation.
 * This client-side role choice is only routing; it is NEVER an authorization boundary.
 */
export async function usesSalesPipelineProjection(): Promise<boolean> {
  const profile = await getCurrentProfile();
  return Boolean(profile?.is_active && profile.role === "Sales");
}
export type SalesReadRpc =
  "read_sales_estimates" | "read_sales_proposals" | "read_sales_walkthroughs" | "read_sales_catalog";
export async function readSalesPipeline<T>(name: SalesReadRpc): Promise<T[]> {
  const db = getSupabaseClient() as unknown as {
    rpc: (name: string) => Promise<{data: unknown;error: {message:string}|null}>
  };
  const {data,error} = await db.rpc(name);
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error("Unexpected Sales pipeline result.");
  return data as T[];
}
