import type { AgreementFrequency } from "@/types/agreement";
export function contractorBookingFrequency(value: unknown): AgreementFrequency {
 const key=String(value??"").toLowerCase().replace(/[\s-]/g,"");
 const values:Record<string,AgreementFrequency>={weekly:"Weekly",biweekly:"Biweekly",everyotherweek:"Biweekly",monthly:"Monthly",twicemonthly:"Twice Monthly",multipledaysperweek:"Multiple Days Per Week",every4weeks:"Every 4 Weeks",daily:"Daily",custom:"Custom"};
 return values[key]??"One-Time";
}
