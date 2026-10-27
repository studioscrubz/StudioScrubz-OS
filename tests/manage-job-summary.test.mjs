import test from 'node:test';
import assert from 'node:assert/strict';
import { jobGpsStatus } from '../lib/jobs/manageJobSummary.ts';

const now=Date.parse('2026-10-27T20:00:00Z');
const base={configured:true,radiusMeters:250,manager:true,lastCheck:null,employeeChecks:[],exceptions:[]};
const check={employeeId:'lead',result:'Within Radius',checkedAt:new Date(now-1000).toISOString(),distanceMeters:4,accuracyMeters:5};
test('GPS summary distinguishes setup, exceptions, missing checks and valid lead verification',()=>{
 assert.equal(jobGpsStatus(null,'lead','admin',now),'Loading status…');
 assert.equal(jobGpsStatus({...base,configured:false},'lead','admin',now),'Setup Required');
 assert.equal(jobGpsStatus({...base,exceptions:[{employeeId:'lead',approvedAt:new Date(now).toISOString()}]},'lead','admin',now),'Awaiting Verification');
 assert.equal(jobGpsStatus({...base,employeeChecks:[check]},'lead','admin',now),'Verified');
 assert.equal(jobGpsStatus({...base,lastCheck:check},'lead','lead',now),'Verified');
 assert.equal(jobGpsStatus({...base,lastCheck:check},'lead','admin',now),'Awaiting Verification');
});
test('expired verification, another employee, or a newer outside-radius check cannot show Verified',()=>{
 assert.equal(jobGpsStatus({...base,employeeChecks:[{...check,checkedAt:new Date(now-13*3600000).toISOString()}]},'lead','admin',now),'Awaiting Verification');
 assert.equal(jobGpsStatus({...base,employeeChecks:[{...check,employeeId:'member'}]},'lead','admin',now),'Awaiting Verification');
 assert.equal(jobGpsStatus({...base,employeeChecks:[check,{...check,result:'Outside Radius',checkedAt:new Date(now).toISOString()}]},'lead','admin',now),'Awaiting Verification');
});
