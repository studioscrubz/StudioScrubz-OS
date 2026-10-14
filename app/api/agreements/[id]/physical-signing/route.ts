import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  MAX_PHYSICAL_AGREEMENT_FILE_BYTES,
  MAX_PHYSICAL_AGREEMENT_FILES,
  PHYSICAL_AGREEMENT_MIME_TYPES,
  type PhysicalAgreementFile,
  type PhysicalAgreementMimeType,
} from "@/types/physicalAgreement";
import type { ServiceAgreement } from "@/types/agreement";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
type Profile = { id: string; role: string; is_active: boolean };
type RpcError = { message: string };
type PhysicalSigningRpc = {
  rpc(
    name: "finalize_physical_service_agreement",
    args: {
      p_agreement_id: string;
      p_event_id: string;
      p_physically_signed_on: string;
      p_required_client_signature_confirmed: boolean;
      p_all_other_signatures_confirmed: boolean;
      p_files: UploadedFileMetadata[];
      p_replace: boolean;
    },
  ): PromiseLike<{ data: ServiceAgreement | null; error: RpcError | null }>;
};
type UploadedFileMetadata = {
  id: string;
  original_filename: string;
  storage_path: string;
  mime_type: PhysicalAgreementMimeType;
  size_bytes: number;
  page_order: number;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await requirePhysicalSigningAdministrator();
    const admin = createSupabaseAdminClient();
    const [{ data: agreement, error: agreementError }, { data: files, error: filesError }, { count, error: eventError }] = await Promise.all([
      admin.from("service_agreements").select("signing_method,physically_signed_on,physical_signed_uploaded_by_name,physical_signed_uploaded_at").eq("id", id).single(),
      admin.from("service_agreement_physical_files").select("id,agreement_id,signing_event_id,original_filename,mime_type,size_bytes,page_order,uploaded_by_name,uploaded_at,archived_at").eq("agreement_id", id).is("archived_at", null).order("page_order"),
      admin.from("service_agreement_physical_signing_events").select("id", { count: "exact", head: true }).eq("agreement_id", id),
    ]);
    if (agreementError) throw new Error(agreementError.message);
    if (filesError) throw new Error(filesError.message);
    if (eventError) throw new Error(eventError.message);
    return Response.json({
      signingMethod: agreement.signing_method === "physical" ? "physical" : null,
      physicallySignedOn: agreement.physically_signed_on,
      uploadedBy: agreement.physical_signed_uploaded_by_name,
      uploadedAt: agreement.physical_signed_uploaded_at,
      files: (files ?? []) as PhysicalAgreementFile[],
      replacementCount: Math.max(0, (count ?? 0) - 1),
    });
  } catch (cause) {
    return apiError(cause);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const uploadedPaths: string[] = [];
  try {
    const { id } = await context.params;
    const { server } = await requirePhysicalSigningAdministrator();
    const form = await request.formData();
    const physicallySignedOn = String(form.get("physicallySignedOn") ?? "");
    const clientSignatureConfirmed = form.get("clientSignatureConfirmed") === "true";
    const otherSignaturesConfirmed = form.get("otherSignaturesConfirmed") === "true";
    const replace = form.get("replace") === "true";
    const files = form.getAll("files").filter((value): value is File => value instanceof File);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(physicallySignedOn)) throw badRequest("Enter the date the Agreement was physically signed.");
    const signingDate = new Date(`${physicallySignedOn}T12:00:00Z`);
    if (Number.isNaN(signingDate.getTime()) || physicallySignedOn > new Date().toISOString().slice(0, 10)) throw badRequest("The physical signing date cannot be in the future.");
    if (!clientSignatureConfirmed || !otherSignaturesConfirmed) throw badRequest("Confirm that every required signature is present.");
    if (files.length < 1 || files.length > MAX_PHYSICAL_AGREEMENT_FILES) throw badRequest(`Upload between 1 and ${MAX_PHYSICAL_AGREEMENT_FILES} signed Agreement files.`);
    for (const file of files) await validateFile(file);

    const admin = createSupabaseAdminClient();
    const { data: agreement, error: agreementError } = await admin.from("service_agreements").select("id,status,signing_method,client_signed_at,client_signature").eq("id", id).single();
    if (agreementError || !agreement) throw badRequest("Service Agreement not found.");
    if (agreement.client_signed_at || agreement.client_signature || agreement.signing_method === "electronic") throw conflict("This Agreement already has an electronic signature and cannot be marked as physically signed.");
    if (replace ? agreement.signing_method !== "physical" : agreement.status !== "Sent" || agreement.signing_method !== null) {
      throw conflict(replace ? "There is no physical signed copy to replace." : "Only an unsigned Sent Agreement can receive a physical signed copy.");
    }

    const eventId = crypto.randomUUID();
    const metadata: UploadedFileMetadata[] = [];
    for (const [index, file] of files.entries()) {
      const fileId = crypto.randomUUID();
      const storedFilename = sanitizeFilename(file.name);
      const storagePath = `agreements/${id}/${eventId}/${fileId}/${storedFilename}`;
      const { error } = await admin.storage.from("signed-agreements").upload(storagePath, file, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false,
      });
      if (error) throw new Error(error.message || "Signed Agreement upload failed.");
      uploadedPaths.push(storagePath);
      metadata.push({
        id: fileId,
        original_filename: file.name,
        storage_path: storagePath,
        mime_type: file.type as PhysicalAgreementMimeType,
        size_bytes: file.size,
        page_order: index + 1,
      });
    }

    const { data, error } = await (server as unknown as PhysicalSigningRpc).rpc("finalize_physical_service_agreement", {
      p_agreement_id: id,
      p_event_id: eventId,
      p_physically_signed_on: physicallySignedOn,
      p_required_client_signature_confirmed: clientSignatureConfirmed,
      p_all_other_signatures_confirmed: otherSignaturesConfirmed,
      p_files: metadata,
      p_replace: replace,
    });
    if (error || !data) throw new Error(error?.message || "The physical signing event could not be finalized.");
    return Response.json(data);
  } catch (cause) {
    if (uploadedPaths.length) {
      const { error } = await createSupabaseAdminClient().storage.from("signed-agreements").remove(uploadedPaths);
      if (error) console.error("Physical Agreement staging cleanup failed", { uploadedPaths, message: error.message });
    }
    return apiError(cause);
  }
}

async function requirePhysicalSigningAdministrator(): Promise<{ server: Awaited<ReturnType<typeof createSupabaseServerClient>>; profile: Profile }> {
  const server = await createSupabaseServerClient();
  const { data: { user } } = await server.auth.getUser();
  if (!user) throw unauthorized("Authentication is required.");
  const { data, error } = await server.from("user_profiles").select("id,role,is_active").eq("id", user.id).single();
  if (error || !data?.is_active || !["Master Admin", "Administrator"].includes(data.role)) throw forbidden("Physical Agreement signing requires an active Master Admin or Administrator account.");
  return { server, profile: data as Profile };
}

async function validateFile(file: File) {
  if (!file.size || file.size > MAX_PHYSICAL_AGREEMENT_FILE_BYTES) throw badRequest("Each signed Agreement file must be non-empty and no larger than 25 MB.");
  if (!(PHYSICAL_AGREEMENT_MIME_TYPES as readonly string[]).includes(file.type)) throw badRequest("Signed Agreement files must be PDF, JPG, or PNG.");
  if (!file.name || file.name.length > 255) throw badRequest("Each signed Agreement filename must be 255 characters or fewer.");
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const valid = file.type === "application/pdf"
    ? bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-"
    : file.type === "image/jpeg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  if (!valid) throw badRequest(`“${file.name}” does not match its declared file type.`);
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function apiError(cause: unknown) {
  const status = cause && typeof cause === "object" && "status" in cause && typeof cause.status === "number" ? cause.status : 400;
  const message = cause instanceof Error && cause.message ? cause.message : "The physical signed Agreement could not be processed.";
  return Response.json({ error: message }, { status });
}
function httpError(message: string, status: number) { return Object.assign(new Error(message), { status }); }
const badRequest = (message: string) => httpError(message, 400);
const unauthorized = (message: string) => httpError(message, 401);
const forbidden = (message: string) => httpError(message, 403);
const conflict = (message: string) => httpError(message, 409);
