import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function requireMasterAdmin(){const db=await createSupabaseServerClient();const {data:{user}}=await db.auth.getUser();if(!user)throw Object.assign(new Error("Authentication required."),{status:401});const {data}=await db.from("user_profiles").select("role,is_active").eq("id",user.id).single();if(!data?.is_active||data.role!=="Master Admin")throw Object.assign(new Error("Master Admin authorization is required."),{status:403});return user}
export function apiError(error:unknown){const status=(error as {status?:number}).status||500;return Response.json({error:error instanceof Error?error.message:"Calendar operation failed."},{status})}
