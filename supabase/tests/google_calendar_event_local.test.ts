import assert from "node:assert/strict";
// @ts-expect-error Node's direct type-strip runner requires the explicit extension.
import {buildEvent,deterministicEventId,uniqueAttendees} from "../../lib/google-calendar/event.ts";
const job={id:"11111111-2222-3333-4444-555555555555",job_number:"JOB-1047",service_name:"Deep Cleaning",client_name:"Synthetic Client",scheduled_date:"2026-08-28",start_time:"10:30:00",estimated_duration:3,assigned_crew_id:"crew",property:{address:"123 Test St",city:"Los Angeles",state:"CA",zip:"90001"}};
assert.equal(deterministicEventId(job.id),"ssjob11111111222233334444555555555555");
assert.deepEqual(uniqueAttendees(["TechA@example.invalid","techa@example.invalid","bad",null,"techb@example.invalid"]),[{email:"techa@example.invalid"},{email:"techb@example.invalid"}]);
const event=buildEvent(job,"America/Los_Angeles",120,uniqueAttendees(["a@example.invalid","b@example.invalid"]),"http://localhost:3000","Crew A");
assert.equal(event.start.dateTime,"2026-08-28T10:30:00");assert.equal(event.end.dateTime,"2026-08-28T13:30:00");assert.equal(event.attendees.length,2);assert(!event.description.includes("price"));assert(!event.description.includes("invoice"));
const fallback=buildEvent({...job,estimated_duration:null},"America/Los_Angeles",90,[],"http://localhost:3000");assert.equal(fallback.end.dateTime,"2026-08-28T12:00:00");
assert.throws(()=>buildEvent({...job,scheduled_date:null},"America/Los_Angeles",120,[],"http://localhost:3000"),/scheduled date/);
console.log("Google Calendar event/idempotency/attendee tests passed.");
