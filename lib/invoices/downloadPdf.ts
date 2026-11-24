import type {InvoiceWithRelations} from "@/types/invoice";

// Produce a downloadable PDF without a popup, print dialog, or third-party service.
// Only customer-facing fields are included; internal invoice notes are excluded.
function plain(value:unknown):string {
 return String(value??"").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g,"")
  .replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"')
  .replace(/[\u2013\u2014]/g,"-").replace(/[^\x20-\x7E]/g,"?");
}
function escapeText(value:string){return value.replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");}
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
function wrap(text:string,width=89):string[]{
 const out:string[]=[];
 for(const paragraph of plain(text).split(/\r?\n/)){
  if(!paragraph.trim()){out.push("");continue;}
  let line="";
  for(const word of paragraph.split(/\s+/)){
   if(line && (line+" "+word).length>width){out.push(line);line="";}
   if(word.length>width){
    if(line){out.push(line);line="";}
    for(let at=0;at<word.length-width;at+=width)out.push(word.slice(at,at+width));
    line=word.slice(Math.floor((word.length-1)/width)*width);
   }else line=line?line+" "+word:word;
  }
  out.push(line);
 }
 return out;
}
export function invoicePdfBytes(invoice:InvoiceWithRelations):Uint8Array {
 const lines:Array<{text:string;bold:boolean}>=[];
 const add=(text:string,bold=false)=>{for(const part of wrap(text))lines.push({text:part,bold});};
 const space=()=>lines.push({text:"",bold:false});
 add("STUDIOSCRUBZ",true);add("INVOICE "+invoice.invoice_number,true);space();
 add("Bill To: "+(invoice.client_name??""));
 add("Property: "+(invoice.property_name??""));
 add("Service: "+(invoice.service_name??""));
 if(invoice.job?.job_number)add("Job Number: "+invoice.job.job_number);
 if(invoice.job?.scheduled_date)add("Service Date: "+invoice.job.scheduled_date);
 if(invoice.job?.service_address)add("Service Address: "+invoice.job.service_address);
 add("Invoice Date: "+invoice.issue_date);
 add("Due Date: "+(invoice.due_date??"Due on receipt"));
 add("Status: "+invoice.status);
 space();
 if(invoice.is_consolidated&&invoice.job_lines.length){
  add("JOBS & LOCATIONS",true);
  for(const job of invoice.job_lines){
   add(job.job_number_snapshot+" | "+job.service_date_snapshot+" | "+money(job.amount),true);
   add([job.property_name_snapshot,job.property_address_snapshot,job.service_name_snapshot].filter(Boolean).join(" | "));
  }
  space();
 }
 add("SERVICES",true);
 for(const item of invoice.line_items){
  add(item.description||"Service");
  add("  Quantity: "+item.quantity+"   Rate: "+money(item.rate)+"   Amount: "+money(item.amount));
 }
 space();
 add("Subtotal: "+money(invoice.subtotal));
 if(invoice.discount>0)add("Discount: -"+money(invoice.discount));
 if(invoice.tax>0)add("Tax: "+money(invoice.tax));
 add("Total: "+money(invoice.total),true);
 add("Amount Paid: "+money(invoice.amount_paid));
 add("Balance Due: "+money(invoice.balance_due),true);
 if(invoice.customer_notes?.trim()){space();add("INVOICE NOTES",true);add(invoice.customer_notes);}
 if(invoice.terms?.trim()){space();add("TERMS",true);add(invoice.terms);}
 space();add("No mess. No stress.");
 const perPage=49;
 const pages=[] as string[];
 for(let start=0;start<lines.length;start+=perPage){
  const content:string[]=["BT"];
  for(const [idx,row] of lines.slice(start,start+perPage).entries()){
   const y=744-idx*14;
   content.push("/"+(row.bold?"F2":"F1")+" 10 Tf");
   content.push("1 0 0 1 48 "+y+" Tm");
   content.push("("+escapeText(row.text)+") Tj");
  }
  content.push("ET");
  pages.push(content.join("\n")+"\n");
 }
 const objectBodies:string[]=[];
 const push=(body:string)=>{objectBodies.push(body);return objectBodies.length;};
 const catalog=push("");
 const pageTree=push("");
 const normalFont=push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
 const boldFont=push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
 const refs:number[]=[];
 for(const stream of pages){
  const streamRef=push("<< /Length "+stream.length+" >>\nstream\n"+stream+"endstream");
  refs.push(push("<< /Type /Page /Parent "+pageTree+" 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 "+normalFont+" 0 R /F2 "+boldFont+" 0 R >> >> /Contents "+streamRef+" 0 R >>"));
 }
 objectBodies[pageTree-1]="<< /Type /Pages /Count "+refs.length+" /Kids ["+refs.map(ref=>ref+" 0 R").join(" ")+"] >>";
 objectBodies[catalog-1]="<< /Type /Catalog /Pages "+pageTree+" 0 R >>";
 let pdf="%PDF-1.4\n";
 const offsets=[0];
 objectBodies.forEach((body,index)=>{offsets.push(pdf.length);pdf+=(index+1)+" 0 obj\n"+body+"\nendobj\n";});
 const xref=pdf.length;
 pdf+="xref\n0 "+(objectBodies.length+1)+"\n0000000000 65535 f \n";
 for(const offset of offsets.slice(1))pdf+=String(offset).padStart(10,"0")+" 00000 n \n";
 pdf+="trailer\n<< /Size "+(objectBodies.length+1)+" /Root "+catalog+" 0 R >>\nstartxref\n"+xref+"\n%%EOF\n";
 return new TextEncoder().encode(pdf);
}
export function downloadInvoicePdf(invoice:InvoiceWithRelations):void{
 const blob=new Blob([invoicePdfBytes(invoice) as BlobPart],{type:"application/pdf"});
 const url=URL.createObjectURL(blob);
 const link=document.createElement("a");
 link.href=url;
 link.download=plain(invoice.invoice_number).replace(/[^A-Za-z0-9._-]/g,"_")+".pdf";
 document.body.appendChild(link);
 link.click();
 link.remove();
 window.setTimeout(()=>URL.revokeObjectURL(url),60000);
}
