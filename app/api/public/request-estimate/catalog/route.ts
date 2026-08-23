import { loadAuthoritativeCatalog, publicCatalog } from "@/lib/services/publicEstimateRequests";
export const dynamic="force-dynamic";
export async function GET(){try{return Response.json(publicCatalog(await loadAuthoritativeCatalog()),{headers:{"Cache-Control":"private, max-age=60"}})}catch{return Response.json({error:"Estimate options are temporarily unavailable."},{status:503})}}
