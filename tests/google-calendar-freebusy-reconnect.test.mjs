import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("OAuth requests only extra calendar availability permission and preserves prior scopes",()=>{
 const connect=read("app/api/integrations/google-calendar/connect/route.ts");
 assert.match(connect,/https:\/\/www\.googleapis\.com\/auth\/calendar\.freebusy/);
 assert.match(connect,/https:\/\/www\.googleapis\.com\/auth\/calendar\.events\.owned/);
 assert.match(connect,/include_granted_scopes:"true"/);
 assert.match(connect,/access_type:"offline"/);
 assert.match(connect,/prompt:"consent"/);
});
test("Callback verifies calendar freebusy grant before changing connection",()=>{
 const callback=read("app/api/integrations/google-calendar/callback/route.ts");
 const scope=callback.indexOf('tokens.scope.split(" ").includes("https://www.googleapis.com/auth/calendar.freebusy")');
 const write=callback.indexOf('const connection={connected_account_email:');
 assert.ok(scope>0&&write>scope);
 assert.match(callback,/\.update\(\{\.\.\.connection,updated_at:/);
 assert.match(callback,/\.eq\("id",existing\.id\)/);
 assert.doesNotMatch(callback,/google_calendar_connections"\)\.delete\(\)/);
});
test("Missing Google permission gives clear contractor operations guidance without exposing event details",()=>{
 const route=read("app/api/contractors/route.ts");
 assert.match(route,/Google Calendar availability needs to be reauthorized by StudioScrubz Operations/);
 assert.match(route,/status\?:number/);
});
