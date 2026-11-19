"use client";
import {useReportWebVitals} from "next/web-vitals";

// Keep performance data within the browser, separate from public marketing
// analytics. Performance entries are inspectable in browser developer tools.
export function OsWebVitals(){
 useReportWebVitals(metric=>{
  if(!["LCP","INP","CLS","FCP","TTFB"].includes(metric.name))return;
  if(typeof window!=="undefined"&&typeof performance.mark==="function"){
   performance.mark(`studioscrubz:web-vital:${metric.name}`,{
    detail:{value:metric.value,metric:metric.name},
   });
  }
 });
 return null;
}
