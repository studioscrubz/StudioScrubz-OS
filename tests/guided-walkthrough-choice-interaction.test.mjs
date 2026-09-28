import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { nextGuidedWalkthroughSelection } from "../components/walkthroughs/guidedWalkthroughChoiceState.ts";

const root = process.cwd();
const components = [
  "PostConstructionFieldWalkthrough.tsx",
  "StandardResidentialFieldWalkthrough.tsx",
  "DeepCleaningFieldWalkthrough.tsx",
  "MoveInOutFieldWalkthrough.tsx",
  "CommercialJanitorialFieldWalkthrough.tsx",
  "PropertyManagementCommonAreasFieldWalkthrough.tsx",
  "OfficeCleaningFieldWalkthrough.tsx",
  "BarbershopSalonFieldWalkthrough.tsx",
  "RetailCleaningFieldWalkthrough.tsx",
  "EventVenueCleaningFieldWalkthrough.tsx",
  "WarehouseCleaningFieldWalkthrough.tsx",
  "RestaurantCleaningFieldWalkthrough.tsx",
];

test("shared guided choice interactions update controlled answers and retain them across navigation", () => {
  let answers = {};
  let section = 0;

  answers.occupancy = nextGuidedWalkthroughSelection([], "Occupied", false)[0];
  assert.equal(answers.occupancy, "Occupied", "single-select selects an option");

  answers.occupancy = nextGuidedWalkthroughSelection([answers.occupancy], "Vacant", false)[0];
  assert.equal(answers.occupancy, "Vacant", "another single-select replaces it");

  answers.hasPets = nextGuidedWalkthroughSelection([], "Yes", false)[0];
  assert.equal(answers.hasPets, "Yes", "Yes/No uses the same single-select behavior");
  assert.equal(answers.hasPets === "Yes", true, "triggering choice immediately enables its conditional field");

  answers.flooring = nextGuidedWalkthroughSelection([], "Tile", true);
  answers.flooring = nextGuidedWalkthroughSelection(answers.flooring, "Carpet", true);
  assert.deepEqual(answers.flooring, ["Tile", "Carpet"], "multi-select retains independent choices");
  answers.flooring = nextGuidedWalkthroughSelection(answers.flooring, "Tile", true);
  assert.deepEqual(answers.flooring, ["Carpet"], "multi-select toggles a choice off");

  section += 1;
  section -= 1;
  assert.equal(section, 0);
  assert.equal(answers.occupancy, "Vacant", "controlled answers survive Continue/Previous navigation");
  assert.deepEqual(answers.flooring, ["Carpet"], "draft answers remain in the controlled state");
});

test("every guided walkthrough consumes the shared choice control", async () => {
  const shared = await readFile(path.join(root, "components/walkthroughs/GuidedWalkthroughChoice.tsx"), "utf8");
  assert.match(shared, /type="button"/);
  assert.match(shared, /aria-pressed=\{isSelected\}/);
  assert.match(shared, /onClick=/);

  for (const file of components) {
    const source = await readFile(path.join(root, "components/walkthroughs", file), "utf8");
    assert.match(source, /GuidedWalkthroughChoice/, `${file} must use the shared choice control`);
    assert.doesNotMatch(source, /type="radio"/, `${file} must not keep a local radio implementation`);
  }
});
