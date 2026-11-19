import {ContractorPortalAdminPreview} from "@/components/contractors/ContractorPortalAdminPreview";
export default async function Page({searchParams}:{searchParams:Promise<{companyId?:string}>}){
 const {companyId}=await searchParams;
 return <ContractorPortalAdminPreview companyId={companyId??""}/>;
}
