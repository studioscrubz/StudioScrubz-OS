import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const settings=readFileSync(new URL("../components/settings/ProfitabilitySettings.tsx",import.meta.url),"utf8");

test("Business Settings shows dollar-per-mile units and cents example",()=>{
 assert.match(settings,/Mileage Rate \(\$ \/ mile\)/);
 assert.match(settings,/0\.725 means 72\.5¢ per mile/);
 assert.match(settings,/72\.50 means \$72\.50 per mile/);
});
test("Business Settings requires explicit acknowledgment of unusually high mileage rates",()=>{
 assert.match(settings,/vehicleOperatingRatePerMile > 5/);
 assert.match(settings,/confirmedUnusualVehicleRate/);
 assert.match(settings,/unusuallyHighVehicleRate && !confirmedUnusualVehicleRate/);
 assert.match(settings,/role="alert"/);
 assert.match(settings,/setConfirmedUnusualVehicleRate\(false\)/);
});
