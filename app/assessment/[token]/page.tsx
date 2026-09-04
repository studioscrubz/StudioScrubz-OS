import { CustomerAssessmentPhotos } from "@/components/walkthroughs/CustomerAssessmentPhotos";

export default async function AssessmentPhotoPage({params}:{params:Promise<{token:string}>}){const {token}=await params;return <CustomerAssessmentPhotos token={token}/>}
