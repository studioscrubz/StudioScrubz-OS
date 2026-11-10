const DEPOSIT_THRESHOLD_CENTS = 50_000;

export function invoiceDepositCents(total: number) {
  const totalCents = Math.round(total * 100);
  return totalCents > DEPOSIT_THRESHOLD_CENTS ? Math.round(totalCents / 4) : 0;
}

export function outstandingInvoiceDepositCents(total: number, amountPaid: number, requested: boolean) {
  return requested ? Math.max(0, invoiceDepositCents(total) - Math.round(amountPaid * 100)) : 0;
}
