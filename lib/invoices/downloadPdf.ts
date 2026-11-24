import type {InvoiceWithRelations} from "@/types/invoice";

// One branded PDF source for previews, downloads and invoice email attachments.
// Keep financial figures and customer-facing terms exactly as saved in the invoice.
const GREEN="#143d1a";
const GOLD="#d4af37";
const money=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value);
function readable(value:unknown):string{
 return String(value??"").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g,"")
  .replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"')
  .replace(/[\u2013\u2014]/g,"-").replace(/\u2026/g,"...")
  .replace(/\u2022/g,"-").replace(/\?{2,}/g," ").replace(/[\u00a0\u2000-\u200b\ufeff]/g," ")
  .replace(/[^\x0a\x0d\x20-\x7e]/g,"");
}
function escaped(value:string):string{
 return readable(value).replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");
}
function wrap(value:unknown,max=90):string[]{
 const out:string[]=[];
 for(const paragraph of readable(value).split(/\r?\n/)){
  if(!paragraph.trim()){out.push("");continue;}
  let current="";
  for(const word of paragraph.trim().split(/\s+/)){
   if(word.length>max){
    if(current){out.push(current);current="";}
    for(let i=0;i<word.length;i+=max)out.push(word.slice(i,i+max));
    continue;
   }
   if(current && (current+" "+word).length>max){out.push(current);current="";}
   current=current?current+" "+word:word;
  }
  if(current)out.push(current);
 }
 return out;
}
function rgb(hex:string):string{
 const parts=[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)/255);
 return parts.map(n=>n.toFixed(3)).join(" ");
}
function textAt(text:string,x:number,y:number,size=10,bold=false,color="#232a24"):string{
 return `${rgb(color)} rg BT /${bold?"F2":"F1"} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escaped(text)}) Tj ET\n`;
}
function rectangle(x:number,y:number,w:number,h:number,color:string):string{
 return `${rgb(color)} rg ${x} ${y} ${w} ${h} re f\n`;
}

async function logoImage():Promise<Uint8Array|null>{
 if(typeof Image==="undefined"||typeof document==="undefined"||typeof atob==="undefined")return null;
 return new Promise(resolve=>{
  const image=new Image();
  image.onload=()=>{
   try{
    const canvas=document.createElement("canvas");
    canvas.width=220;canvas.height=220;
    const ctx=canvas.getContext("2d");
    if(!ctx)return resolve(null);
    // Match the document header so the official square logo sits seamlessly in the PDF.
    ctx.fillStyle=GREEN;ctx.fillRect(0,0,220,220);
    const aspect=image.naturalWidth/image.naturalHeight;
    const width=aspect>=1?214:214*aspect;
    const height=aspect>=1?214/aspect:214;
    ctx.drawImage(image,(220-width)/2,(220-height)/2,width,height);
    const base64=canvas.toDataURL("image/jpeg",0.88).split(",")[1];
    const binary=atob(base64);
    resolve(Uint8Array.from(binary,ch=>ch.charCodeAt(0)));
   }catch{resolve(null);}
  };
  image.onerror=()=>resolve(null);
  image.src="/branding/studioscrubz-logo.png";
 });
}

export async function invoicePdfBytes(invoice:InvoiceWithRelations):Promise<Uint8Array>{
 const logo=await logoImage();
 const streams:string[]=[];
 let commands="";
 let y=610;
 const startPage=()=>{
  if(commands)streams.push(commands);
  commands="";
  commands+=rectangle(0,678,612,114,GREEN);
  commands+=`${rgb("#80b645")} rg 0 670 m 230 650 420 703 612 689 c 612 671 l 0 657 l h f\n`;
  commands+=rectangle(0,0,612,37,GREEN);
  commands+=rectangle(0,37,612,7,"#a4d766");
  commands+=textAt("No mess. No stress.",242,13,12,true,"#ffffff");
  if(logo)commands+="q 88 0 0 88 34 690 cm /Im1 Do Q\n";
  commands+=textAt("StudioScrubz",logo?138:46,732,25,true,GOLD);
  commands+=textAt("PROFESSIONAL CLEANING SERVICES",logo?140:48,712,8,true,"#ffffff");
  commands+=textAt("INVOICE",43,638,25,true,GREEN);
  commands+=textAt(invoice.invoice_number,44,622,10,true,GREEN);
  y=590;
 };
 const check=(height:number)=>{if(y-height<68)startPage();};
 const gap=(amount=11)=>{check(amount);y-=amount;};
 const line=(content:string,bold=false,size=10,color="#232a24",left=44)=>{
  const max=left===44?88:73;
  for(const value of wrap(content,max)){
   check(size+6);
   commands+=textAt(value,left,y,size,bold,color);
   y-=size+5;
  }
 };
 const heading=(value:string)=>{
  check(33);gap(5);commands+=rectangle(44,y-6,524,23,GREEN);
  commands+=textAt(value.toUpperCase(),53,y+1,11,true,"#ffffff");y-=31;
 };
 const field=(label:string,value:unknown)=>{
  const clean=readable(value);
  if(clean)line(label+": "+clean,false,10);
 };
 startPage();
 field("Bill To",invoice.client_name);
 field("Property / Site",invoice.property_name);
 field("Service",invoice.service_name);
 if(invoice.job?.job_number)field("Job",invoice.job.job_number);
 if(invoice.job?.scheduled_date)field("Service Date",invoice.job.scheduled_date);
 if(invoice.job?.service_address)field("Service Address",invoice.job.service_address);
 field("Invoice Date",invoice.issue_date);
 field("Due Date",invoice.due_date??"Due on receipt");
 field("Status",invoice.status);
 gap(7);
 if(invoice.is_consolidated && invoice.job_lines.length){
  heading("Jobs and Locations");
  for(const job of invoice.job_lines){
   line([job.job_number_snapshot,job.service_date_snapshot,money(job.amount)].filter(Boolean).join("  |  "),true,9);
   line([job.property_name_snapshot,job.property_address_snapshot,job.service_name_snapshot].filter(Boolean).join("  |  "),false,9);
   gap(3);
  }
 }
 heading("Services");
 for(const item of invoice.line_items){
  check(39);
  line(item.description||"Service",true,10);
  line("Quantity: "+item.quantity+"     Rate: "+money(item.rate)+"     Amount: "+money(item.amount),false,9);
  gap(4);
 }
 heading("Invoice Summary");
 field("Subtotal",money(invoice.subtotal));
 if(invoice.discount>0)field("Discount","-"+money(invoice.discount));
 if(invoice.tax>0)field("Tax",money(invoice.tax));
 check(24);
 commands+=rectangle(44,y-7,524,20,"#e9f5d6");
 commands+=textAt("TOTAL   "+money(invoice.total),54,y,12,true,GREEN);y-=30;
 field("Amount Paid",money(invoice.amount_paid));
 line("BALANCE DUE   "+money(invoice.balance_due),true,12,GREEN);
 if(invoice.customer_notes?.trim()){
  heading("Invoice Notes");for(const value of wrap(invoice.customer_notes,90))line(value,false,9);
 }
 if(invoice.terms?.trim()){
  heading("Terms");
  for(const value of wrap(invoice.terms,90)){
   if(value)line(value,false,9);
   else gap(7);
  }
 }
 streams.push(commands);
 const objects:string[]=[];
 const push=(value:string)=>{objects.push(value);return objects.length;};
 const catalog=push(""),tree=push("");
 const regular=push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
 const bold=push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
 const logoRef=logo?push(""):null;
 const refs:number[]=[];
 for(const stream of streams){
  const content=push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  refs.push(push(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> ${logoRef?"/XObject << /Im1 "+logoRef+" 0 R >>":""} >> /Contents ${content} 0 R >>`));
 }
 if(logoRef&&logo){
  const binary=Array.from(logo,n=>String.fromCharCode(n)).join("");
  objects[logoRef-1]=`<< /Type /XObject /Subtype /Image /Width 220 /Height 220 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.byteLength} >>\nstream\n${binary}\nendstream`;
 }
 objects[tree-1]=`<< /Type /Pages /Count ${refs.length} /Kids [${refs.map(n=>n+" 0 R").join(" ")}] >>`;
 objects[catalog-1]=`<< /Type /Catalog /Pages ${tree} 0 R >>`;
 let doc="%PDF-1.4\n";
 const offsets=[0];
 for(const [i,body] of objects.entries()){
  offsets.push(doc.length);doc+=`${i+1} 0 obj\n${body}\nendobj\n`;
 }
 const xref=doc.length;
 doc+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
 for(const offset of offsets.slice(1))doc+=String(offset).padStart(10,"0")+" 00000 n \n";
 doc+=`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Uint8Array.from(doc,char=>char.charCodeAt(0)&255);
}

export async function downloadInvoicePdf(invoice:InvoiceWithRelations):Promise<void>{
 const bytes=await invoicePdfBytes(invoice);
 const blob=new Blob([bytes as BlobPart],{type:"application/pdf"});
 const url=URL.createObjectURL(blob);
 const link=document.createElement("a");
 link.href=url;
 link.download=readable(invoice.invoice_number).replace(/[^A-Za-z0-9._-]/g,"_")+".pdf";
 document.body.appendChild(link);
 link.click();
 link.remove();
 window.setTimeout(()=>URL.revokeObjectURL(url),60000);
}
