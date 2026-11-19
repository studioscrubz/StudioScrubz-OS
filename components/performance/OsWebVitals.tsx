"use client";
import {useReportWebVitals} from "next/web-vitals";
import {track} from "@vercel/analytics";

// Privacy-safe browser speed signals: no email, job ID, invoice ID or user data.
export function OsWebVitals(){
 useReportWebVitals(metric=>{
  if(!["LCP","INP","CLS","FCP","TTFB"].includes(metric.name))return;
  track("os_web_vital",{metric:metric.name,value:Math.round(metric.value*100)/100});
 });
 return null;
}
