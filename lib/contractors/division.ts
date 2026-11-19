export type ContractorDivision="Residential"|"Commercial";
export const RESIDENTIAL_OPEN_MINUTE=8*60;
export const RESIDENTIAL_LAST_START_MINUTE=18*60;
export const RESIDENTIAL_CLOSE_MINUTE=20*60;
export function validContractorDivision(value:unknown):value is ContractorDivision{
 return value==="Residential"||value==="Commercial";
}
export function contractorBookingWindow(division:ContractorDivision){
 return division==="Residential"?{open:RESIDENTIAL_OPEN_MINUTE,lastStart:RESIDENTIAL_LAST_START_MINUTE,close:RESIDENTIAL_CLOSE_MINUTE}:null;
}
export function contractorTimeMinutes(time:string){
 if(!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time))return null;
 const [hour,minute]=time.split(":").map(Number);
 return hour*60+minute;
}
export function contractorStartAllowed(division:ContractorDivision,time:string,durationMinutes=0){
 const minute=contractorTimeMinutes(time);
 if(minute===null)return false;
 const hours=contractorBookingWindow(division);
 if(!hours)return true;
 return minute>=hours.open&&minute<=hours.lastStart&&minute+Math.max(0,durationMinutes)<=hours.close;
}

/** Residential bookings are closed on Sundays (Pacific calendar date). */
export function contractorDateAllowed(division:ContractorDivision,date:string){
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
 if(!match)return false;
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 const dayUtc=new Date(Date.UTC(year,month-1,day));
 if(dayUtc.getUTCFullYear()!==year||dayUtc.getUTCMonth()+1!==month||dayUtc.getUTCDate()!==day)return false;
 return division!=="Residential"||dayUtc.getUTCDay()!==0;
}
