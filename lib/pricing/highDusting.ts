export type HighDustingInputs = {
 cleaners:number; hoursPerCleaner:number; hourlyLaborCost:number;
 equipment:number; supplies:number; travelAndOverhead:number; targetMarginPercent:number;
 workingHeight:string; accessMethods:string[]; scope:string;
};
export const defaultHighDustingInputs: HighDustingInputs = {
 cleaners:2,hoursPerCleaner:5,hourlyLaborCost:30,
 equipment:75,supplies:35,travelAndOverhead:60,targetMarginPercent:35,
 workingHeight:"",accessMethods:[],scope:""
};
export const approvedHighDustingAccessMethods = [
 "Approved extension tools","Appropriate ladder setup","Scissor lift","Other reviewed access method"
] as const;
export function priceHighDusting(input:HighDustingInputs) {
 if(!input || !Number.isInteger(input.cleaners) || input.cleaners<1 || !Number.isFinite(input.hoursPerCleaner) || input.hoursPerCleaner<=0 ||
  !Number.isFinite(input.hourlyLaborCost)||input.hourlyLaborCost<30 ||
  ![input.equipment,input.supplies,input.travelAndOverhead].every(n=>Number.isFinite(n)&&n>=0) ||
  !Number.isFinite(input.targetMarginPercent)||input.targetMarginPercent<25||input.targetMarginPercent>50) throw new Error("Enter valid High Dusting labor, costs and margin.");
 if(!input.workingHeight.trim()||!input.scope.trim()||!Array.isArray(input.accessMethods)||!input.accessMethods.length||
  input.accessMethods.some(method=>!(approvedHighDustingAccessMethods as readonly string[]).includes(method))||
  new Set(input.accessMethods).size!==input.accessMethods.length) throw new Error("Record working height, scope and at least one approved access method.");
 const laborCost=input.cleaners*input.hoursPerCleaner*input.hourlyLaborCost;
 const supplyCost=input.equipment+input.supplies+input.travelAndOverhead;
 const directCost=laborCost+supplyCost;
 const finalPrice=Math.round((directCost/(1-input.targetMarginPercent/100)+Number.EPSILON)*100)/100;
 return {laborCost,supplyCost,directCost,finalPrice,grossProfit:finalPrice-directCost,
  description:`High Dusting: ${input.scope.trim()}. Height: ${input.workingHeight.trim()}. Access methods: ${input.accessMethods.join(", ")}. Equipment and site safety to be confirmed during walkthrough.`};
}
