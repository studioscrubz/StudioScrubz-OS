import type { Metadata } from "next";
import { PublicEstimateRequest } from "@/components/estimates/PublicEstimateRequest";
export const metadata:Metadata={title:"Request an Estimate",description:"Request a residential or commercial cleaning estimate from StudioScrubz."};
export default function Page(){return <PublicEstimateRequest/>}
