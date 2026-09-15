import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, globals = {}) {
  const target = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: target, exports: target.exports, Date, ...globals });
  return target.exports;
}
const at = Date.now();
const position = { latitude: 34, longitude: -118, accuracy: 10, capturedAt: new Date(at).toISOString() };
const geo = load("../lib/geo/currentPosition.ts");
test("valid current coordinates accepted; invalid, inaccurate and stale GPS rejected", () => {
  assert.equal(geo.validatePosition(position, at), position);
  for (const patch of [{ latitude: NaN }, { latitude: 91 }, { longitude: -181 }, { accuracy: 101 }, { accuracy: -1 }, { capturedAt: "bad" }, { capturedAt: new Date(at - 61000).toISOString() }]) {
    assert.throws(() => geo.validatePosition({ ...position, ...patch }, at));
  }
});
test("browser requests fresh accurate GPS; permission denial, timeout and unavailable are readable", async () => {
  for (const [code, pattern] of [[1, /permission was denied/], [2, /unavailable/], [3, /timed out/]]) {
    const api = load("../lib/geo/currentPosition.ts", { navigator: { geolocation: { getCurrentPosition(ok, fail, options) {
      assert.equal(options.enableHighAccuracy, true); assert.equal(options.maximumAge, 0); assert.equal(options.timeout, 20000);
      fail({ code });
    } } } });
    await assert.rejects(api.getCurrentPosition(), pattern);
  }
  await assert.rejects(geo.getCurrentPosition(), /unavailable/);
});
test("browser position is validated before resolving", async () => {
  const api = load("../lib/geo/currentPosition.ts", { navigator: { geolocation: { getCurrentPosition(ok) { ok({ coords: position, timestamp: at }); } } } });
  assert.equal((await api.getCurrentPosition()).latitude, 34);
});
test("service create, finish and cancel notify mounted summaries only on success; errors propagate", async () => {
  const calls = [], events = [];
  let failure = null;
  const api = load("../lib/services/gpsMileage.ts", {
    Event: class { constructor(type) { this.type = type; } }, window: { dispatchEvent(event) { events.push(event.type); } },
    require(name) {
      if (name.endsWith("/mileage")) return { MILEAGE_CHANGED_EVENT: "mileage" };
      return { getSupabaseClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: { id: "trip" }, error: failure }; } }) };
    },
  });
  await api.startGpsTrip("job", "vehicle", position);
  await api.finishGpsTrip("trip", position);
  await api.cancelGpsTrip("trip");
  assert.equal(events.filter(x => x === "mileage").length, 3);
  assert.equal(calls[0].args.p_job_id, "job");
  assert.equal(calls[1].args.p_id, "trip");
  failure = { message: "GPS mileage access denied." };
  for (const run of [() => api.startGpsTrip("job", "vehicle", position), () => api.finishGpsTrip("trip", position), () => api.cancelGpsTrip("trip"), () => api.getGpsTrips("job"), () => api.getGpsMileageForJob("job")]) await assert.rejects(run(), /access denied/);
  assert.equal(events.length, 6);
});
const sql = readFileSync(new URL("../supabase/migrations/20260912010000_job_gps_mileage_v1.sql", import.meta.url), "utf8");
const compactSql = sql.replace(/\s+/g, " ");
test("SQL contract: self/assignment authorization, restricted writes, transaction and idempotency guards", () => {
  assert.match(compactSql, /enable row level security/);
  assert.match(compactSql, /revoke all on public.job_mileage_trips from public, anon, authenticated/);
  assert.match(compactSql, /p_employee_id = public.current_employee_id\(\)/);
  assert.match(compactSql, /public.is_assigned_to_crew\( j.assigned_crew_id \)/);
  assert.match(compactSql, /where status = 'Active'/);
  assert.match(compactSql, /where status <> 'Cancelled'/);
  assert.match(compactSql, /if t.status = 'Completed' then return t;/);
  assert.match(compactSql, /where id = p_id for update/);
  assert.match(compactSql, /round\( miles \* coalesce\(rate, 0\), 2 \)/);
  assert.match(compactSql, /mileage_rate_snapshot = rate, mileage_entry_id = entry_id/);
  assert.ok(compactSql.indexOf("insert into public.mileage_entries") < compactSql.indexOf("set status = 'Completed'"));
  for (const definition of sql.split(/create function /).slice(1)) if (/security definer/.test(definition)) assert.match(definition, /set search_path = ''/);
  assert.doesNotMatch(sql, /update public.jobs|start_operational_job|start_or_clock_in_to_job|alter.*policy/i);
});
test("ARRIVED creates a normal vehicle/job-linked mileage entry and both mileage views refresh", () => {
  const insert = compactSql.match(/insert into public\.mileage_entries \((.*?)\) values \((.*?)\) returning id into entry_id/s);
  assert.ok(insert, "finish_job_gps_trip must insert into mileage_entries");
  for (const field of ["mileage_number", "trip_date", "vehicle_id", "employee_id", "crew_id", "job_id", "client_id", "property_id", "trip_purpose", "start_location", "end_location", "miles", "round_trip", "business_use", "mileage_rate", "deductible_amount", "notes"]) {
    assert.match(insert[1], new RegExp(`\\b${field}\\b`));
  }
  assert.match(insert[2], /t\.vehicle_id, t\.employee_id, j\.assigned_crew_id, j\.id, j\.client_id, j\.property_id/);
  assert.match(compactSql, /status = 'Completed'.*mileage_entry_id = entry_id/s);

  const vehiclesPage = readFileSync(new URL("../components/vehicles/VehiclesPage.tsx", import.meta.url), "utf8");
  const jobSummary = readFileSync(new URL("../components/vehicles/JobMileageSummary.tsx", import.meta.url), "utf8");
  assert.match(vehiclesPage, /addEventListener\(MILEAGE_CHANGED_EVENT, refresh\)/);
  assert.match(jobSummary, /addEventListener\(MILEAGE_CHANGED_EVENT, refresh\)/);
});
test("all operational roles use GPS while management selects vehicles and field access stays assigned", () => {
  const jobsPage = readFileSync(new URL("../components/jobs/JobsPage.tsx", import.meta.url), "utf8");
  const expansion = readFileSync(new URL("../supabase/migrations/20260915194754_expand_gps_mileage_to_management.sql", import.meta.url), "utf8").replace(/\s+/g, " ");

  assert.match(jobsPage, /\["Master Admin", "Administrator", "Manager", "Crew Lead", "Scrub Technician"\]\.includes/);
  assert.doesNotMatch(jobsPage, /initiateJobOnMyWay/);
  assert.match(jobsPage, /management \? "Select active vehicle" : "Select assigned vehicle"/);
  assert.match(jobsPage, /if \(!management && eligible\.length === 1\) setVehicleId/);

  assert.match(expansion, /caller_role not in \('Master Admin', 'Administrator', 'Manager', 'Crew Lead', 'Scrub Technician'\)/);
  assert.match(expansion, /not management and \( e is null or not exists/);
  assert.match(expansion, /v\.assigned_employee_id = e or public\.is_assigned_to_crew\(v\.assigned_crew_id\)/);
  assert.match(expansion, /notification := public\.initiate_job_on_my_way\(p_job_id\)/);
  assert.match(expansion, /job_id, user_id, employee_id, vehicle_id/);
  assert.match(expansion, /t\.user_id is distinct from auth\.uid\(\)/);
  assert.match(expansion, /insert into public\.mileage_entries/);
  assert.doesNotMatch(expansion, /alter column user_id set not null/);
  assert.doesNotMatch(expansion, /update public\.job_mileage_trips .* set user_id/s);
  assert.doesNotMatch(expansion, /drop index public\.job_gps_one_active_employee|drop index public\.job_gps_one_trip_per_job/);
  assert.match(expansion, /if exists \( select 1 from public\.job_mileage_trips where status = 'Active' \) then raise exception 'Complete or cancel all active GPS trips before applying/);
  assert.match(expansion, /where user_id = caller_id and job_id = p_job_id/);
  assert.match(expansion, /p_job_id, caller_id, e, p_vehicle_id/);
  assert.match(compactSql, /has_any_role\( array\['Master Admin', 'Administrator', 'Manager'\] \) or \( public\.has_any_role/);
  assert.match(compactSql, /select t\.\* from public\.job_mileage_trips t where t\.job_id = p_job_id and public\.can_read_job_gps\( t\.job_id, t\.employee_id \)/);
  assert.doesNotMatch(expansion, /start_operational_job|start_or_clock_in_to_job|time_entries|payroll/i);
});
