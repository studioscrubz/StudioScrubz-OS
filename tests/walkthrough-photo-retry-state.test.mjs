import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  "components/walkthroughs/FieldWalkthroughsPage.tsx",
  "utf8"
);

test("walkthrough photo retry rendering is driven by reactive state", () => {
  assert.match(
    page,
    /const \[retryPhoto, setRetryPhoto\] = useState<File \| null>\(null\)/
  );
  assert.match(page, /\{retryPhoto && !busy && !readOnly && \(/);
  assert.match(page, /void upload\(retryPhoto\)/);
  assert.doesNotMatch(page, /\{pendingPhoto\.current &&/);
});

test("failed uploads retain a retry candidate and successful uploads clear it", () => {
  assert.match(
    page,
    /operationInFlight\.current = true;\s*updatePendingPhoto\(file\);\s*setBusy\(true\)/
  );
  assert.match(
    page,
    /const items = await uploadOperationalPhoto\([\s\S]*?updatePendingPhoto\(null\);\s*setPhotos/
  );
  assert.match(
    page,
    /catch \{\s*setError\("Photo upload failed\. Confirm your assignment and try again\."\);\s*\}/
  );
});

test("successful initial uploads and closing the walkthrough leave no retry state", () => {
  assert.match(
    page,
    /function updatePendingPhoto\(file: File \| null\) \{\s*pendingPhoto\.current = file;\s*setRetryPhoto\(file\);\s*\}/
  );
  assert.match(
    page,
    /onClick=\{\(\) => \{\s*updatePendingPhoto\(null\);\s*close\(\);\s*\}\}/
  );
});

test("walkthrough save and completion still reject an unresolved photo upload", () => {
  assert.match(
    page,
    /if \(pendingPhoto\.current\) \{\s*setError\(\s*"Retry the pending photo upload before saving or completing this walkthrough\."/
  );
  assert.match(page, /recordType: "walkthroughs"/);
  assert.match(page, /customerVisible: false/);
});
