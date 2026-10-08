import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const calculator = readFileSync("components/estimates/PublicEstimateRequest.tsx", "utf8");
const publicEstimateService = readFileSync("lib/services/publicEstimateRequests.ts", "utf8");

test("customer estimate frequency options retain canonical values while displaying friendly labels", () => {
  assert.match(
    calculator,
    /options\.map\(x=><option key=\{x\} value=\{x\}>\{label==="Frequency"\?serviceFrequencyLabel\(x\):x\}<\/option>\)/,
  );
  assert.match(
    calculator,
    /\["One-Time","Daily","Weekly","Biweekly","Twice Monthly","Monthly"\]/,
  );
});

test("changing frequency remains part of the authoritative quote request", () => {
  assert.match(calculator, /const payload=useMemo\(\(\)=>\(\{[^}]*frequency/);
  assert.match(calculator, /fetch\("\/api\/public\/request-estimate\/quote"[^;]*body:JSON\.stringify\(payload\)/);
  for (const frequency of ["One-Time", "Daily", "Weekly", "Biweekly", "Twice Monthly", "Monthly"]) {
    assert.match(publicEstimateService, new RegExp(`"${frequency}"`));
  }
});

test("a one-time-only service cannot retain an incompatible recurring frequency", () => {
  assert.match(
    calculator,
    /if\(selected&&!selected\.recurring&&frequency!=="One-Time"\)setFrequency\("One-Time"\)/,
  );
});
