import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const page=readFileSync(new URL("../components/invoices/InvoicesPage.tsx",import.meta.url),"utf8");
test("invoice email shows PDF preview using the exact attachment bytes",()=>{
 assert.match(page,/const attachmentBytes=useMemo\(\(\)=>invoicePdfBytes\(invoice\),\[invoice\]\)/);
 assert.match(page,/const pdf=await attachmentBytes/);
 assert.match(page,/new Blob\(\[bytes as BlobPart\],\{type:"application\/pdf"\}\)/);
 assert.match(page,/Preview Attachment/);
 assert.match(page,/aria-label="Invoice PDF attachment preview"/);
 assert.match(page,/src=\{previewUrl\}/);
 assert.match(page,/Open PDF in new tab/);
 assert.match(page,/URL\.revokeObjectURL\(url\)/);
 assert.match(page,/sendCommunicationsEmail\(/);
});
