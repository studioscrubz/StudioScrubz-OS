import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../lib/services/technicianKitStandards.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const baseline = { exports: {} };
new Function('exports', compiled)(baseline.exports);
const { KIT_ITEMS, TOWEL_COLORS, requiredKitItems, replenishment, microfiberAvailability, containerReplenishment } = baseline.exports;

test('approved kit has 27 distinct categories and no disposable serialization', () => {
  assert.equal(KIT_ITEMS.length, 27);
  assert.equal(new Set(KIT_ITEMS.map(i => i.id)).size, 27);
});
test('standard, deep and move-in/out checklists preserve conditional specialties', () => {
  assert.equal(requiredKitItems('standard').length, 19);
  assert.equal(requiredKitItems('deep').length, 22);
  assert.equal(requiredKitItems('move-in-out').length, 22);
  assert.equal(requiredKitItems('standard', ['grout', 'brushes']).length, 21);
  assert.equal(requiredKitItems('deep', ['grout', 'grout']).length, 23);
  assert.throws(() => requiredKitItems('commercial'));
  assert.throws(() => requiredKitItems('standard', ['unknown']));
});
test('restocking uses inclusive threshold and replenishes to target', () => {
  assert.deepEqual(replenishment(100, 35, 35), { due: true, quantity: 65 });
  assert.deepEqual(replenishment(100, 36, 35), { due: false, quantity: 64 });
  assert.deepEqual(replenishment(100, 110, 35), { due: false, quantity: 0 });
  for (const current of [-1, NaN, Infinity]) assert.throws(() => replenishment(100, current, 35));
});
test('microfiber colors total 100/35; dirty stock never becomes available', () => {
  assert.equal(TOWEL_COLORS.reduce((n,c) => n+c.target,0), 100);
  assert.equal(TOWEL_COLORS.reduce((n,c) => n+c.threshold,0), 35);
  const counts = TOWEL_COLORS.map(c => ({ color:c.name, clean:c.target, dirty:100 }));
  assert.equal(microfiberAvailability(counts).clean, 100);
  assert.equal(microfiberAvailability(counts).due, false);
  counts[0].clean=5;
  assert.equal(microfiberAvailability(counts).due, true);
  assert.equal(microfiberAvailability(counts).quantity, 10);
  const thresholds = TOWEL_COLORS.map(c => ({ color:c.name, clean:c.threshold, dirty:100 }));
  assert.equal(microfiberAvailability(thresholds).clean, 35);
  assert.equal(microfiberAvailability(thresholds).due, true);
  assert.throws(() => microfiberAvailability([...counts, counts[0]]));
});
test('bulk chemicals use measurable actual container capacities and 25 percent threshold', () => {
  assert.deepEqual(containerReplenishment(128,32), {due:true,quantity:96});
  assert.deepEqual(containerReplenishment(56,14), {due:true,quantity:42});
  assert.deepEqual(containerReplenishment(16,4), {due:true,quantity:12});
  assert.throws(() => containerReplenishment(0,0));
  assert.throws(() => containerReplenishment(16,17));
});
test('inventory routes and management actions follow the existing role architecture', () => {
  const text = readFileSync(new URL('../lib/auth/permissions.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const permissions = {};
  new Function('exports', code)(permissions);
  assert.equal(permissions.permissionForPath('/inventory'), 'inventory.view');
  for (const role of ['Master Admin','Manager','Crew Lead','Scrub Technician','Sales','Administrator','Lead Representative']) {
    const profile = {role,is_active:true,employee_id:'test-employee'};
    assert.equal(permissions.hasPermission(profile,'inventory.view'), ['Master Admin','Manager','Crew Lead','Scrub Technician'].includes(role));
    assert.equal(permissions.hasPermission(profile,'inventory.manage'), ['Master Admin','Manager'].includes(role));
    assert.equal(permissions.hasPermission({...profile,is_active:false},'inventory.view'), false);
  }
});
