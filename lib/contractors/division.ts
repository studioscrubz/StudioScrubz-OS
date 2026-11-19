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
