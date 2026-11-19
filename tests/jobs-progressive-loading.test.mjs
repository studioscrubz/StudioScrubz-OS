import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../components/jobs/JobsPage.tsx",import.meta.url),"utf8");
const section=source.slice(source.indexOf("export function JobsPage()"),source.indexOf("  async function mutate("));
test("Jobs primary content does not wait for time, crew, technician or archive data",()=>{
 assert.match(section,/void getJobs\(\)[\s\S]*?setRows\(jobs\)[\s\S]*?setLoading\(false\)/);
 assert.match(section,/void getTimeEntries\(\)\.then/);
 assert.match(section,/void getActiveCrews\(\)\.then/);
 assert.match(section,/if \(jobId\) \{\s*void getArchivedJobs\(\)/);
 assert.doesNotMatch(section,/void Promise\.all\(\[\s*getJobs\(\)/);
});
test("Jobs realtime refreshes time and crews independently of main job list",()=>{
 assert.match(section,/useOperationalRealtime\(\["time_entries"\], async \(\) => \{ setTimeEntries\(await getTimeEntries\(\)\); \}\)/);
 assert.match(section,/useOperationalRealtime\(\["crews"\], async \(\) => \{ setActiveCrews\(await getActiveCrews\(\)\); \}\)/);
 assert.match(section,/useOperationalRealtime\(\["jobs", "service_occurrences", "invoices", "job_crew_technicians"\]/);
});
