import assert from "node:assert/strict";
import test from "node:test";
import { invoiceDepositCents, outstandingInvoiceDepositCents } from "../lib/invoiceDeposit.ts";

test("a deposit is 25% of the invoice total, rounded to cents, strictly above $500", () => {
  assert.equal(invoiceDepositCents(499.99), 0);
  assert.equal(invoiceDepositCents(500), 0);
  assert.equal(invoiceDepositCents(500.01), 12_500);
  assert.equal(invoiceDepositCents(500.02), 12_501);
  assert.equal(invoiceDepositCents(750), 18_750);
});

test("only opted-in invoices request deposits, and prior payments apply toward the deposit", () => {
  assert.equal(outstandingInvoiceDepositCents(750, 0, false), 0);
  assert.equal(outstandingInvoiceDepositCents(750, 0, true), 18_750);
  assert.equal(outstandingInvoiceDepositCents(750, 50, true), 13_750);
  assert.equal(outstandingInvoiceDepositCents(750, 187.50, true), 0);
  assert.equal(outstandingInvoiceDepositCents(750, 200, true), 0);
});
