export const ONBOARDING_STEPS = [
 ["offer_accepted","Signed offer verified"],
 ["w4_verified","Federal W-4 securely completed"],
 ["de4_verified","California DE 4 securely completed"],
 ["i9_section1_verified","I-9 Section 1 verified"],
 ["i9_section2_verified","I-9 Section 2 verified"],
 ["wage_notice_provided","California wage notice provided"],
 ["workers_comp_notice_provided","Workers' compensation information provided"],
 ["pay_method_verified","Payroll payment method verified"],
 ["handbook_ack_verified","Handbook acknowledgment verified"],
 ["attendance_policy_verified","Attendance and timekeeping policy verified"],
 ["uniform_policy_verified","Uniform and appearance policy verified"],
 ["client_privacy_verified","Client privacy and access policy verified"],
 ["incident_policy_verified","Incident/damage reporting policy verified"],
 ["safety_policy_verified","Workplace safety training/acknowledgment verified"],
 ["chemical_safety_training","Chemical safety training completed"],
 ["ppe_training","PPE training completed"],
 ["cleaning_checklists_training","Cleaning checklists training completed"],
 ["gps_photo_training","Job-site GPS and photos training completed"],
 ["time_clock_training","Time Clock training completed"],
 ["paid_training_recorded","Paid orientation/training time recorded"],
 ["supervisor_assigned","First-shift supervisor assigned"],
] as const;
export type OnboardingStepCode = typeof ONBOARDING_STEPS[number][0];
export type OnboardingStatus="draft"|"invited"|"in_progress"|"ready_for_review"|"completed"|"canceled";
export function onboardingStepsComplete(steps:Array<{code:string;completed_at:string|null}>){
 return ONBOARDING_STEPS.every(([code])=>steps.some(step=>step.code===code&&!!step.completed_at));
}
