import {Suspense} from "react";
import {ContractorActivate} from "@/components/contractors/ContractorActivate";
export default function Page(){return <Suspense fallback={<p>Checking invitation…</p>}><ContractorActivate/></Suspense>;}
