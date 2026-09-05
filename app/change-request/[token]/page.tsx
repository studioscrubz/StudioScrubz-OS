import type { Metadata } from "next";
import { PublicChangeRequestPage } from "@/components/changeRequests/PublicChangeRequestPage";
export const metadata:Metadata={robots:{index:false,follow:false}};
export default async function Page({params}:PageProps<"/change-request/[token]">){const{token}=await params;return <PublicChangeRequestPage token={token}/>}
