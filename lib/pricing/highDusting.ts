export type HighDustingInputs = {
 cleaners:number; hoursPerCleaner:number; hourlyLaborCost:number;
 equipment:number; supplies:number; travelAndOverhead:number; targetMarginPercent:number;
 squareFeet:number; bathrooms:number; kitchens:number; commonAreas:number; units:number;
 workingHeight:string; accessMethods:string[]; scope:string;
};
export const defaultHighDustingInputs: HighDustingInputs = {
 cleaners:2,hoursPerCleaner:5,hourlyLaborCost:30,
 equipment:75,supplies:35,travelAndOverhead:60,targetMarginPercent:35,
 squareFeet:0,bathrooms:0,kitchens:0,commonAreas:0,units:0,
 workingHeight:"",accessMethods:[],scope:""
};
export const approvedHighDustingAccessMethods = [
 "Approved extension tools","Appropriate ladder setup","Scissor lift","Other reviewed access method"
] as const;
export function priceHighDusting(input:HighDustingInputs) {
 if(!input) throw new Error("Enter the High Dusting calculator details.");
 if(!Number.isInteger(input.cleaners)||input.cleaners<1) throw new Error("Number of cleaners must be at least 1.");
 if(!Number.isFinite(input.hoursPerCleaner)||input.hoursPerCleaner<=0) throw new Error("Enter hours greater than 0 for each cleaner.");
 if(!Number.isFinite(input.hourlyLaborCost)||input.hourlyLaborCost<30) throw new Error("Hourly labor cost must be at least $30.");
 if(!Number.isFinite(input.equipment)||input.equipment<0) throw new Error("Equipment cost cannot be negative.");
 if(!Number.isFinite(input.supplies)||input.supplies<0) throw new Error("Supplies cost cannot be negative.");
 if(!Number.isFinite(input.travelAndOverhead)||input.travelAndOverhead<0) throw new Error("Travel and overhead cost cannot be negative.");
 if(!Number.isFinite(input.targetMarginPercent)||input.targetMarginPercent<25||input.targetMarginPercent>50) throw new Error("Target gross margin must be between 25% and 50%.");
 if(!Number.isFinite(input.squareFeet)||input.squareFeet<=0) throw new Error("Enter required High Dusting square footage greater than zero.");
 for(const [label,count] of [["Bathrooms",input.bathrooms],["Kitchens",input.kitchens],["Common areas",input.commonAreas],["Units",input.units]] as const) {
  if(!Number.isInteger(count)||count<0) throw new Error(`${label} must be a whole number of zero or more.`);
 }
 if(!input.workingHeight?.trim()) throw new Error("Enter the highest surface or working height.");
 if(!input.scope?.trim()) throw new Error("Describe the elevated surfaces and scope.");
 if(!Array.isArray(input.accessMethods)||!input.accessMethods.length) throw new Error("Select at least one access method.");
 if(input.accessMethods.some(method=>!(approvedHighDustingAccessMethods as readonly string[]).includes(method))||new Set(input.accessMethods).size!==input.accessMethods.length) throw new Error("Review the selected access methods.");
 const laborCost=input.cleaners*input.hoursPerCleaner*input.hourlyLaborCost;
 const supplyCost=input.equipment+input.supplies+input.travelAndOverhead;
 const directCost=laborCost+supplyCost;
 const finalPrice=Math.round((directCost/(1-input.targetMarginPercent/100)+Number.EPSILON)*100)/100;
 return {laborCost,supplyCost,directCost,finalPrice,grossProfit:finalPrice-directCost,
  description:`High Dusting: ${input.squareFeet} sq ft; ${input.bathrooms} bathrooms; ${input.kitchens} kitchens; ${input.commonAreas} common areas; ${input.units} units. ${input.scope.trim()}. Height: ${input.workingHeight.trim()}. Access methods: ${input.accessMethods.join(", ")}. Equipment and site safety to be confirmed during walkthrough.`};
}
