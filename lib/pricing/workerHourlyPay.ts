export const MINIMUM_WORKER_HOURLY_PAY = 30;

export function requireMinimumWorkerHourlyPay(value: number): number {
  if (!Number.isFinite(value) || value < MINIMUM_WORKER_HOURLY_PAY) {
    throw new Error(`Worker hourly pay must be at least $${MINIMUM_WORKER_HOURLY_PAY.toFixed(2)} per hour.`);
  }
  return value;
}
