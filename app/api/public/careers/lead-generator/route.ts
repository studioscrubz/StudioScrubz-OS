import { JobApplicationError, submitLeadGeneratorApplication, type LeadGeneratorApplicationInput } from "@/lib/recruiting/leadGeneratorApplications";
const attempts=new Map<string,{count:number;reset:number}>();
export async function POST(request:Request){const ip=(request.headers.get("x-forwarded-for")??"unknown").split(",")[0].trim(),now=Date.now(),entry=attempts.get(ip);if(entry&&entry.reset>now&&entry.count>=5)return Response.json({error:"Too many requests. Please try again later."},{status:429});attempts.set(ip,{count:entry&&entry.reset>now?entry.count+1:1,reset:entry&&entry.reset>now?entry.reset:now+15*60_000});try{let payload: LeadGeneratorApplicationInput;
let resume: File | null = null;
if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
  const data = await request.formData();
  const application = data.get("application");
  const file = data.get("resume");
  if (typeof application !== "string" || !(file instanceof File))
    throw new JobApplicationError("Invalid résumé upload.");
  payload = JSON.parse(application) as LeadGeneratorApplicationInput;
  resume = file;
} else {
  payload = await request.json() as LeadGeneratorApplicationInput;
}
const result=await submitLeadGeneratorApplication(payload,ip,resume);return Response.json(result,{status:201})}catch(cause){const error=cause instanceof JobApplicationError?cause:new JobApplicationError("Application could not be submitted.",500);return Response.json({error:error.message},{status:error.status})}}
