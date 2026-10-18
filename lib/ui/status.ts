export type SemanticTone = "brand" | "success" | "info" | "warning" | "danger" | "neutral";
const statusTones: Readonly<Record<string, SemanticTone>> = {
  accepted:"success",active:"success",completed:"success",converted:"success",paid:"success",resolved:"success",succeeded:"success",verified:"success","fully signed":"success",
  "in progress":"info",open:"info",sent:"info",viewed:"info",
  "awaiting client signature":"warning","awaiting studioscrubz signature":"warning",draft:"warning",lead:"warning","partially paid":"warning",pending:"warning","pending approval":"warning",planned:"warning","ready for approval":"warning","ready to schedule":"warning",scheduled:"warning",
  blocked:"danger",declined:"danger",error:"danger",expired:"danger",failed:"danger",overdue:"danger","past due":"danger",rejected:"danger",urgent:"danger",
  archived:"neutral",cancelled:"neutral",canceled:"neutral",inactive:"neutral",paused:"neutral",superseded:"neutral",voided:"neutral",
};
export function normalizeStatus(value:string){return value.trim().replace(/[_-]+/g," ").replace(/\s+/g," ").toLowerCase()}
export function statusTone(value:string,fallback:SemanticTone="neutral"):SemanticTone{return statusTones[normalizeStatus(value)]??fallback}
