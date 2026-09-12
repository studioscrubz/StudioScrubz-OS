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
test("SQL contract: self/assignment authorization, restricted writes, transaction and idempotency guards", () => {
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public.job_mileage_trips from public,anon,authenticated/);
  assert.match(sql, /p_employee_id=public.current_employee_id\(\)/);
  assert.match(sql, /public.is_assigned_to_crew\(j.assigned_crew_id\)/);
  assert.match(sql, /where status='Active'/);
  assert.match(sql, /where status <> 'Cancelled'/);
  assert.match(sql, /if t.status='Completed' then return t/);
  assert.match(sql, /where id=p_id for update/);
  assert.match(sql, /round\(miles\*coalesce\(rate,0\),2\)/);
  assert.match(sql, /mileage_rate_snapshot=rate,mileage_entry_id=entry_id/);
  assert.ok(sql.indexOf("insert into public.mileage_entries") < sql.indexOf("set status='Completed'"));
  for (const definition of sql.split(/create function /).slice(1)) if (/security definer/.test(definition)) assert.match(definition, /set search_path = ''/);
  assert.doesNotMatch(sql, /update public.jobs|start_operational_job|start_or_clock_in_to_job|alter.*policy/i);
});
