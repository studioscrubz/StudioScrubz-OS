import { NextResponse } from "next/server";
import { assessmentForToken } from "@/lib/assessmentPhotoAccess";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MAX_OPERATIONAL_PHOTO_BYTES, OPERATIONAL_PHOTO_BUCKET, OPERATIONAL_PHOTO_MIME_TYPES } from "@/types/photo";
import type { OperationalPhoto } from "@/types/photo";

export const dynamic="force-dynamic";

export async function GET(_request:Request,{params}:{params:Promise<{token:string}>}){
  const {token}=await params,assessment=await assessmentForToken(token);
  if(!assessment)return NextResponse.json({error:"Assessment unavailable."},{status:404});
  const photos=(Array.isArray(assessment.walkthrough.photos)?assessment.walkthrough.photos:[]) as OperationalPhoto[];
  const admin=createSupabaseAdminClient();
  const {data:signed,error}=photos.length?await admin.storage.from(OPERATIONAL_PHOTO_BUCKET).createSignedUrls(photos.map(photo=>photo.storagePath),300):{data:[],error:null};
  if(error)return NextResponse.json({error:"Photos could not be loaded."},{status:500});
  return NextResponse.json({assessment:{serviceName:assessment.walkthrough.measurements.serviceType||"Cleaning Service",propertyAddress:assessment.walkthrough.property?.address??null,submittedAt:assessment.access.submitted_at},photos:photos.map((photo,index)=>({id:photo.id,caption:photo.caption,originalFilename:photo.originalFilename,url:signed?.[index]?.signedUrl??null}))},{headers:{"Cache-Control":"private, no-store"}});
}

export async function POST(request:Request,{params}:{params:Promise<{token:string}>}){
  const {token}=await params,assessment=await assessmentForToken(token);
  if(!assessment)return NextResponse.json({error:"Assessment unavailable."},{status:404});
  const form=await request.formData(),file=form.get("file"),caption=String(form.get("caption")??"").trim();
  if(!(file instanceof File))return NextResponse.json({error:"Choose a photo."},{status:400});
  if(!(OPERATIONAL_PHOTO_MIME_TYPES as readonly string[]).includes(file.type)||file.size<1||file.size>MAX_OPERATIONAL_PHOTO_BYTES)return NextResponse.json({error:"Choose a JPEG, PNG, WebP, HEIC, or HEIF photo up to 10 MB."},{status:400});
  const id=crypto.randomUUID(),extension=file.type==="image/jpeg"?"jpg":file.type.split("/")[1],storagePath=`walkthroughs/${assessment.walkthrough.id}/${id}.${extension}`;
  const admin=createSupabaseAdminClient();
  const {error:uploadError}=await admin.storage.from(OPERATIONAL_PHOTO_BUCKET).upload(storagePath,file,{contentType:file.type,upsert:false});
  if(uploadError)return NextResponse.json({error:"Photo upload failed."},{status:500});
  const now=new Date().toISOString(),photo={id,storagePath,category:"General",originalFilename:file.name.slice(0,255),mimeType:file.type,sizeBytes:file.size,uploadedAt:now,uploadedBy:"customer",caption:caption.slice(0,1000)||null,source:"library",customerVisible:false};
  const photos=[...(Array.isArray(assessment.walkthrough.photos)?assessment.walkthrough.photos:[]),photo];
  const measurements={...(assessment.walkthrough.measurements as Record<string,unknown>),assessmentMethod:"Customer Photo Submission",photoSubmissionStatus:"Submitted",photoSubmittedAt:now};
  const {error:updateError}=await admin.from("walkthroughs").update({photos,measurements}).eq("id",assessment.walkthrough.id);
  if(updateError){await admin.storage.from(OPERATIONAL_PHOTO_BUCKET).remove([storagePath]);return NextResponse.json({error:"Photo metadata could not be saved."},{status:500});}
  await admin.from("assessment_photo_access").update({submitted_at:now}).eq("walkthrough_id",assessment.walkthrough.id);
  return NextResponse.json({photo:{id,caption:photo.caption,originalFilename:photo.originalFilename},submittedAt:now},{status:201,headers:{"Cache-Control":"private, no-store"}});
}

