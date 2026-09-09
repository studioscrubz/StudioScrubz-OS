import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
function load(path, dependencies = {}) {
  const target = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: target, exports: target.exports, require: name => {
    if (!(name in dependencies)) throw Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, Date, Set, Error });
  return target.exports;
}
const permissions = load("lib/auth/permissions.ts");
const model = load("types/porterRoute.ts");
const visits = load("types/porterVisit.ts", { "@/types/porterReporting": load("types/porterReporting.ts") });
const stop = { visit_id: "v", stop_notes: null, visit: { status: "Scheduled" } };
const route = { id: "route", status: "Planned", updated_at: "version", stops: [stop] };
const input = { route_date: "2026-09-09", assigned_crew_id: "crew", route_name: null, notes: null, stops: [{ visit_id: "v", stop_notes: null }] };
function api(role, rpc, active = true) {
  return load("lib/services/porterRoutes.ts", { "@/lib/auth/permissions": permissions,
    "@/lib/services/auth": { getCurrentProfile: async () => ({ role, is_active: active }) },
    "@/lib/supabase/client": { getSupabaseClient: () => ({ rpc }) },
    "@/types/porterVisit": visits, "@/types/porterRoute": model });
}
test("six-role read/management rules and inaccessible UUID fails closed", async () => {
  for (const role of ["Master Admin", "Administrator", "Manager", "Crew Lead", "Scrub Technician", "Sales"]) {
    const manager = ["Master Admin", "Administrator", "Manager"].includes(role);
    let calls = 0;
    const service = api(role, async () => { calls++; return { data: [], error: null }; });
    assert.equal(permissions.hasPermission({ role, is_active: true }, permissions.permissionForPath("/properties/porter-routes")), role !== "Sales");
    if (role === "Sales") { await assert.rejects(service.listPorterRoutes(), /access denied/); assert.equal(calls,0); }
    else await service.listPorterRoutes();
    if (manager) { await service.createPorterRoute(input); await service.mutatePorterRoute(route, { action: "start" }); }
    else { await assert.rejects(service.createPorterRoute(input), /access denied/); await assert.rejects(service.mutatePorterRoute(route,{ action: "start" }), /access denied/); }
    if (role !== "Sales") await assert.rejects(service.getPorterRoute("unassigned"), /not found or access denied/);
  }
  await assert.rejects(api("Manager", () => { throw Error("Unexpected read"); }, false).listPorterRoutes(), /access denied/);
});
test("read uses assignment-scoped RPC without caller supplied identity", async () => {
  const calls = [];
  const service = api("Crew Lead", async (name,args) => { calls.push({name,args}); return {data:[route],error:null}; });
  await service.listPorterRoutes(); await service.getPorterRoute("route");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ name:"get_porter_routes",args:{} },{ name:"get_porter_routes",args:{p_id:"route"} }]);
});
test("creation validates date, crew and duplicates before RPC; payload is narrow", async () => {
  let payload;
  const service = api("Manager", async (_,args) => { payload=args; return {data:"route",error:null}; });
  for (const date of ["", "2026-02-30"]) await assert.rejects(service.createPorterRoute({...input,route_date:date}));
  await assert.rejects(service.createPorterRoute({...input,assigned_crew_id:""}), /active crew/);
  await assert.rejects(service.createPorterRoute({...input,stops:[stop,stop]}), /only once/);
  await service.createPorterRoute({...input,created_by:"forged",client_id:"forged"});
  assert.deepEqual(Object.keys(payload).sort(),["p_crew_id","p_name","p_notes","p_route_date","p_stops"]);
});
test("eligible visits match Scheduled/date/crew and cancelled routes release eligibility", () => {
  const base = {id:"v",status:"Scheduled",scheduled_date:input.route_date,assigned_crew_id:"crew"};
  const rows = [base,{...base,id:"other-date",scheduled_date:"2026-09-10"},{...base,id:"other-crew",assigned_crew_id:"else"},{...base,id:"unassigned",assigned_crew_id:null},{...base,id:"started",status:"In Progress"}];
  assert.equal(model.eligibleRouteVisits(rows,[],input.route_date,"crew").length,1);
  for (const status of ["Planned","In Progress","Completed"]) assert.equal(model.eligibleRouteVisits(rows,[{...route,status}],input.route_date,"crew").length,0);
  assert.equal(model.eligibleRouteVisits(rows,[{...route,status:"Cancelled"}],input.route_date,"crew").length,1);
  assert.equal(model.eligibleRouteVisits(rows,[route],input.route_date,"crew","route").length,1);
});
test("Planned add/remove/reorder preserves requested order and version in one mutation", async () => {
  const payloads=[];
  const service=api("Manager",async (_,args)=>{payloads.push(args);return {data:"route",error:null};});
  for (const ids of [["v","v2"],["v2","v"],["v2"]]) {
    await service.mutatePorterRoute(route,{action:"edit",data:{route_name:null,notes:null,stops:ids.map(visit_id=>({visit_id,stop_notes:null}))}});
    const payload=payloads.at(-1);
    assert.equal(payload.p_expected_updated_at,"version");
    assert.deepEqual(Array.from(payload.p_data.stops,stop=>stop.visit_id),ids);
  }
});
test("route lifecycle is independent and terminal routes/started structure are immutable", () => {
  const validate=model.validateRouteMutation;
  assert.doesNotThrow(()=>validate(route,{action:"start"}));
  assert.doesNotThrow(()=>validate(route,{action:"cancel"}));
  assert.equal(route.stops[0].visit.status,"Scheduled");
  assert.throws(()=>validate({...route,stops:[]},{action:"start"}),/at least one/);
  const started={...route,status:"In Progress"};
  assert.throws(()=>validate(started,{action:"edit",data:input}),/Planned/);
  assert.throws(()=>validate(started,{action:"start"}),/Planned/);
  for (const status of ["Scheduled","In Progress"]) assert.throws(()=>validate({...started,stops:[{visit:{status}}]},{action:"complete"}),/every Porter Visit/);
  assert.doesNotThrow(()=>validate({...started,stops:[{visit:{status:"Completed",issues:[{status:"Open"}]}},{visit:{status:"Cancelled"}}]},{action:"complete"}));
  for (const status of ["Completed","Cancelled"]) for(const action of ["start","complete","cancel","edit"]) assert.throws(()=>validate({...route,status},{action,data:input}),/read-only/);
  assert.deepEqual(JSON.parse(JSON.stringify(model.routeProgress({stops:[{visit:{status:"Completed"}},{visit:{status:"Cancelled"}},{visit:null}]}))),{total:3,completed:1,cancelled:1,remaining:1});
});
test("service propagates SQL stale/relationship/reservation errors", async () => {
  for (const message of ["Route changed", "Visit date must match", "Visit crew must match", "Select an active crew", "Visit already belongs to another active route", "Invalid or cross-route stop fields"]) {
    const service=api("Manager",async()=>({data:null,error:{message}}));
    await assert.rejects(service.mutatePorterRoute(route,{action:"edit",data:input}),new RegExp(message));
  }
  await assert.rejects(api("Manager",async()=>({data:null,error:{message:"Offline"}})).listPorterRoutes(),/Offline/);
});
test("migration contract has server scoping, unique reservation, locking and no visit lifecycle writes", () => {
  const sql=readFileSync(new URL("../supabase/migrations/20260909152838_porter_routes_v1.sql",import.meta.url),"utf8");
  assert.match(sql,/unique index porter_one_reserved_route_per_visit[\s\S]*where released_at is null/);
  assert.match(sql,/unique\(route_id,stop_order\) deferrable initially deferred/);
  assert.match(sql,/r.updated_at is distinct from p_expected_updated_at/);
  assert.match(sql,/where id=p_id for update/);
  assert.match(sql,/order by v0.id for update/);
  assert.match(sql,/set released_at=stamp/);
  assert.match(sql,/seq:=seq\+1/);
  assert.match(sql,/before update of scheduled_date,assigned_crew_id/);
  assert.match(sql,/public.can_access_porter_visit\(r.assigned_crew_id\)/);
  assert.match(sql,/public.can_access_porter_visit\(v.assigned_crew_id\)/);
  assert.match(sql,/enable row level security/g);
  assert.doesNotMatch(sql,/update public.property_service_visits set/i);
  for (const fragment of sql.split(/create function /).slice(1)) assert.match(fragment.split(/end \$\$|\$\$;/)[0],/security definer set search_path = ''/);
  assert.match(sql,/revoke all on function public.replace_porter_route_stops\(uuid,jsonb\) from public,anon,authenticated/);
});
