import { getSupabaseClient } from "@/lib/supabase/client";
import type { InvoiceWithRelations } from "@/types/invoice";
import type { PaymentMethod } from "@/types/payment";
import type {
  ClientRevenueSummary,
  CompletedWorkValue,
  DivisionRevenueSummary,
  MonthlyMetric,
  MonthlyPerformance,
  PaymentMethodSummary,
  RevenueDataPoint,
  RevenueDateRange,
  RevenueGroup,
  RevenuePaymentRecord,
  RevenuePeriod,
  RevenueReport,
  RevenueSummary,
  ServiceRevenueSummary,
} from "@/types/revenue";
import {
  getExpensesByCategory,
  getExpensesForDateRange,
} from "@/lib/services/expenses";

const invoiceSelect =
  "*, job:jobs!invoices_job_id_fkey(*, proposal:proposals!jobs_proposal_id_fkey(*), client:clients!jobs_client_id_fkey(*), property:properties!jobs_property_id_fkey(*)), proposal:proposals!invoices_proposal_id_fkey(*), client:clients!invoices_client_id_fkey(*), property:properties!invoices_property_id_fkey(*)";
const paymentSelect =
  "id,amount,payment_date,payment_method,client_id,job_id,invoice:invoices!payments_invoice_id_fkey(id,invoice_number,client_id,client_name,service_name,job:jobs!invoices_job_id_fkey(division))";
type RawPayment = {
  id: string;
  amount: number;
  payment_date: string;
  payment_method: PaymentMethod;
  client_id: string | null;
  job_id: string | null;
  invoice: {
    id: string;
    invoice_number: string;
    client_id: string | null;
    client_name: string | null;
    service_name: string | null;
    job: { division: "Residential" | "Commercial" } | null;
  } | null;
};

export async function getRevenueReport(
  period: RevenuePeriod,
  customStart?: string,
  customEnd?: string,
  group?: RevenueGroup,
): Promise<RevenueReport> {
  const range = getRevenueDateRange(period, customStart, customEnd);
  const [paymentRows, invoices, monthly, completedWork, expenses, actualLaborCost] =
    await Promise.all([
      getPayments(range),
      getPeriodInvoices(range),
      getMonthlyPerformance(),
      getCompletedWorkValue(range),
      getExpensesForDateRange(range.start, range.end),
      getActualLaborCost(range),
    ]);
  const payments = paymentRows.map(mapPayment);
  const summary = getRevenueSummary(payments, invoices);
  const selectedGroup = group ?? defaultGroup(period);
  const byClient = getRevenueByClient(payments, invoices);
  const operatingExpenses = sum(expenses.map((x) => x.amount)),
    operatingProfit = summary.collected - operatingExpenses;
  const revenueMap = new Map(
      getRevenueOverTime(payments, selectedGroup).map((x) => [x.key, x.amount]),
    ),
    expenseMap = new Map<string, number>();
  for (const x of expenses) {
    const key = groupKey(x.expense_date, selectedGroup);
    expenseMap.set(key, (expenseMap.get(key) ?? 0) + Number(x.amount));
  }
  const keys = [
    ...new Set([...revenueMap.keys(), ...expenseMap.keys()]),
  ].sort();
  return {
    range,
    summary,
    operatingExpenses,
    operatingProfit,
    actualLaborCost,
    netOperatingContribution: operatingProfit - actualLaborCost,
    profitMargin: summary.collected
      ? (operatingProfit / summary.collected) * 100
      : null,
    expenses,
    expensesByCategory: getExpensesByCategory(expenses),
    profitOverTime: keys.map((key) => ({
      key,
      label: key,
      revenue: revenueMap.get(key) ?? 0,
      expenses: expenseMap.get(key) ?? 0,
      profit: (revenueMap.get(key) ?? 0) - (expenseMap.get(key) ?? 0),
    })),
    payments,
    invoices,
    overTime: getRevenueOverTime(payments, selectedGroup),
    byClient,
    byService: getRevenueByService(payments, invoices),
    byDivision: getRevenueByDivision(payments, invoices),
    byMethod: getPaymentMethodsSummary(payments),
    outstandingInvoices: getOutstandingInvoices(invoices),
    pastDue: getPastDueSummary(invoices),
    recentPayments: [...payments]
      .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))
      .slice(0, 10),
    monthly,
    completedWork,
    topCustomers: byClient.slice(0, 10),
  };
}
async function getActualLaborCost(range:RevenueDateRange){let query=getSupabaseClient().from("time_entries").select("gross_pay").in("status",["Completed","Approved"]).is("archived_at",null);if(range.start)query=query.gte("work_date",range.start);if(range.end)query=query.lte("work_date",range.end);const{data,error}=await query;if(error)throw error;return sum((data??[]).map(x=>Number(x.gross_pay)))}
export function getRevenueSummary(
  payments: RevenuePaymentRecord[],
  invoices: InvoiceWithRelations[],
): RevenueSummary {
  const active = invoices.filter(
    (x) => !["Cancelled", "Archived"].includes(x.status),
  );
  const collected = sum(payments.map((x) => x.amount));
  const invoiced = sum(active.map((x) => x.total));
  const outstanding = sum(
    active.filter((x) => x.status !== "Paid").map((x) => x.balance_due),
  );
  return {
    collected,
    invoiced,
    outstanding,
    paidInvoices: invoices.filter((x) => x.status === "Paid").length,
    openInvoices: invoices.filter((x) =>
      ["Draft", "Open", "Sent", "Partially Paid", "Past Due"].includes(
        x.status,
      ),
    ).length,
    averageInvoice: active.length ? invoiced / active.length : 0,
    collectionRate: invoiced > 0 ? (collected / invoiced) * 100 : null,
    averagePayment: payments.length ? collected / payments.length : 0,
  };
}
export const getCollectedRevenue = (payments: RevenuePaymentRecord[]) =>
  sum(payments.map((x) => x.amount));
export const getInvoicedRevenue = (invoices: InvoiceWithRelations[]) =>
  sum(
    invoices
      .filter((x) => !["Cancelled", "Archived"].includes(x.status))
      .map((x) => x.total),
  );
export const getOutstandingRevenue = (invoices: InvoiceWithRelations[]) =>
  sum(
    invoices
      .filter((x) => !["Paid", "Cancelled", "Archived"].includes(x.status))
      .map((x) => x.balance_due),
  );
export function getRevenueOverTime(
  payments: RevenuePaymentRecord[],
  group: RevenueGroup,
): RevenueDataPoint[] {
  const values = new Map<string, number>();
  for (const p of payments) {
    const key = groupKey(p.paymentDate, group);
    values.set(key, (values.get(key) ?? 0) + p.amount);
  }
  return [...values]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, amount]) => ({ key, label: key, amount }));
}
export function getRevenueByClient(
  payments: RevenuePaymentRecord[],
  invoices: InvoiceWithRelations[],
): ClientRevenueSummary[] {
  const map = new Map<string, ClientRevenueSummary>();
  for (const invoice of invoices) {
    if (!invoice.client_id) continue;
    const row = map.get(invoice.client_id) ?? {
      clientId: invoice.client_id,
      clientName: invoice.client_name || "Unnamed client",
      totalPaid: 0,
      invoiceCount: 0,
      paidInvoiceCount: 0,
      outstanding: 0,
    };
    row.invoiceCount++;
    row.outstanding += !["Paid", "Cancelled", "Archived"].includes(
      invoice.status,
    )
      ? invoice.balance_due
      : 0;
    if (invoice.status === "Paid") row.paidInvoiceCount++;
    map.set(invoice.client_id, row);
  }
  for (const p of payments) {
    const row = map.get(p.clientId) ?? {
      clientId: p.clientId,
      clientName: p.clientName,
      totalPaid: 0,
      invoiceCount: 0,
      paidInvoiceCount: 0,
      outstanding: 0,
    };
    row.totalPaid += p.amount;
    map.set(p.clientId, row);
  }
  return [...map.values()].sort((a, b) => b.totalPaid - a.totalPaid);
}
export function getRevenueByService(
  payments: RevenuePaymentRecord[],
  invoices: InvoiceWithRelations[],
): ServiceRevenueSummary[] {
  const map = new Map<
    string,
    { collected: number; ids: Set<string>; totals: number }
  >();
  for (const p of payments) {
    const row = map.get(p.service) ?? {
      collected: 0,
      ids: new Set(),
      totals: 0,
    };
    row.collected += p.amount;
    row.ids.add(p.invoiceId ?? `payment:${p.id}`);
    map.set(p.service, row);
  }
  for (const i of invoices) {
    const key = i.service_name || "Unspecified service";
    const row = map.get(key) ?? { collected: 0, ids: new Set(), totals: 0 };
    row.ids.add(i.id);
    row.totals += i.total;
    map.set(key, row);
  }
  return [...map]
    .map(([service, x]) => ({
      service,
      collected: x.collected,
      invoiceCount: x.ids.size,
      averageInvoice: x.ids.size ? x.totals / x.ids.size : 0,
    }))
    .sort((a, b) => b.collected - a.collected);
}
export function getRevenueByDivision(
  payments: RevenuePaymentRecord[],
  invoices: InvoiceWithRelations[],
): DivisionRevenueSummary[] {
  const total = getCollectedRevenue(payments);
  return (["Residential", "Commercial"] as const).map((division) => {
    const collected = sum(
      payments.filter((x) => x.division === division).map((x) => x.amount),
    );
    return {
      division,
      collected,
      percentage: total ? (collected / total) * 100 : 0,
      invoiceCount: invoices.filter((x) => x.job?.division === division).length,
    };
  });
}
export function getPaymentMethodsSummary(
  payments: RevenuePaymentRecord[],
): PaymentMethodSummary[] {
  const map = new Map<PaymentMethod, { total: number; count: number }>();
  for (const p of payments) {
    const row = map.get(p.method) ?? { total: 0, count: 0 };
    row.total += p.amount;
    row.count++;
    map.set(p.method, row);
  }
  return [...map]
    .map(([method, x]) => ({ method, ...x }))
    .sort((a, b) => b.total - a.total);
}
export function getOutstandingInvoices(invoices: InvoiceWithRelations[]) {
  return invoices
    .filter(
      (x) =>
        x.balance_due > 0 &&
        !["Paid", "Cancelled", "Archived"].includes(x.status),
    )
    .sort(
      (a, b) =>
        Number(b.status === "Past Due") - Number(a.status === "Past Due") ||
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
        b.balance_due - a.balance_due,
    )
    .slice(0, 12);
}
export function getPastDueSummary(invoices: InvoiceWithRelations[]) {
  const today = localDate();
  const rows = invoices.filter(
    (x) =>
      x.balance_due > 0 &&
      !["Paid", "Cancelled", "Archived"].includes(x.status) &&
      (x.status === "Past Due" || Boolean(x.due_date && x.due_date < today)),
  );
  return { count: rows.length, balance: sum(rows.map((x) => x.balance_due)) };
}
export async function getRecentPayments() {
  return (await getPayments({ start: null, end: null, label: "All Time" }))
    .map(mapPayment)
    .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))
    .slice(0, 10);
}
export async function getMonthlyPerformance(): Promise<MonthlyPerformance> {
  const now = new Date();
  const currentStart = monthStart(now);
  const nextStart = monthStart(
    new Date(now.getFullYear(), now.getMonth() + 1, 1),
  );
  const previousStart = monthStart(
    new Date(now.getFullYear(), now.getMonth() - 1, 1),
  );
  const [payments, invoices] = await Promise.all([
    getPayments({
      start: previousStart,
      end: addDays(nextStart, -1),
      label: "Monthly comparison",
    }),
    getInvoicesBetween(previousStart, addDays(nextStart, -1)),
  ]);
  const currentPayments = payments.filter(
      (x) => x.payment_date >= currentStart,
    ),
    previousPayments = payments.filter((x) => x.payment_date < currentStart);
  const currentInvoices = invoices.filter((x) => x.issue_date >= currentStart),
    previousInvoices = invoices.filter((x) => x.issue_date < currentStart);
  return {
    collected: metric(
      sum(currentPayments.map((x) => Number(x.amount))),
      sum(previousPayments.map((x) => Number(x.amount))),
    ),
    invoicesIssued: metric(currentInvoices.length, previousInvoices.length),
    paymentsReceived: metric(currentPayments.length, previousPayments.length),
    outstanding: metric(
      sum(currentInvoices.map((x) => x.balance_due)),
      sum(previousInvoices.map((x) => x.balance_due)),
    ),
  };
}
export async function getCompletedWorkValue(
  range: RevenueDateRange,
): Promise<CompletedWorkValue> {
  let query = getSupabaseClient()
    .from("jobs")
    .select("price,completed_at")
    .eq("status", "Completed");
  if (range.start) query = query.gte("completed_at", `${range.start}T00:00:00`);
  if (range.end)
    query = query.lt("completed_at", `${addDays(range.end, 1)}T00:00:00`);
  const { data, error } = await query;
  if (error) throw error;
  const values = (data ?? []).map((x) => Number(x.price));
  const total = sum(values);
  return {
    total,
    average: values.length ? total / values.length : 0,
    count: values.length,
  };
}
export function getRevenueDateRange(
  period: RevenuePeriod,
  customStart?: string,
  customEnd?: string,
): RevenueDateRange {
  const now = new Date();
  const today = localDate(now);
  if (period === "All Time")
    return { start: null, end: null, label: "All Time" };
  if (period === "Today") return { start: today, end: today, label: "Today" };
  if (period === "This Week") {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay());
    return { start: localDate(d), end: today, label: "This Week" };
  }
  if (period === "This Month")
    return { start: monthStart(now), end: today, label: "This Month" };
  if (period === "Last Month") {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return {
      start: monthStart(d),
      end: addDays(monthStart(now), -1),
      label: "Last Month",
    };
  }
  if (period === "This Quarter") {
    const d = new Date(
      now.getFullYear(),
      Math.floor(now.getMonth() / 3) * 3,
      1,
    );
    return { start: localDate(d), end: today, label: "This Quarter" };
  }
  if (period === "This Year")
    return {
      start: `${now.getFullYear()}-01-01`,
      end: today,
      label: "This Year",
    };
  if (period === "Last Year")
    return {
      start: `${now.getFullYear() - 1}-01-01`,
      end: `${now.getFullYear() - 1}-12-31`,
      label: "Last Year",
    };
  return {
    start: customStart || today,
    end: customEnd || today,
    label: `${customStart || today} to ${customEnd || today}`,
  };
}
async function getPayments(range: RevenueDateRange): Promise<RawPayment[]> {
  let query = getSupabaseClient().from("payments").select(paymentSelect);
  if (range.start) query = query.gte("payment_date", range.start);
  if (range.end) query = query.lte("payment_date", range.end);
  const { data, error } = await query.order("payment_date", {
    ascending: false,
  });
  if (error) throw error;
  return data as unknown as RawPayment[];
}
async function getPeriodInvoices(range: RevenueDateRange) {
  return getInvoicesBetween(range.start, range.end);
}
async function getInvoicesBetween(
  start: string | null,
  end: string | null,
): Promise<InvoiceWithRelations[]> {
  let query = getSupabaseClient().from("invoices").select(invoiceSelect);
  if (start) query = query.gte("issue_date", start);
  if (end) query = query.lte("issue_date", end);
  const { data, error } = await query;
  if (error) throw error;
  return data as unknown as InvoiceWithRelations[];
}
function mapPayment(x: RawPayment): RevenuePaymentRecord {
  return {
    id: x.id,
    paymentDate: x.payment_date,
    amount: Number(x.amount),
    method: x.payment_method,
    invoiceId: x.invoice?.id ?? null,
    invoiceNumber: x.invoice?.invoice_number ?? "Deleted Invoice",
    clientId: x.invoice?.client_id ?? x.client_id ?? `deleted-client:${x.id}`,
    clientName: x.invoice?.client_name || "Deleted Client",
    service: x.invoice?.service_name || "Unlinked payment",
    division: x.invoice?.job?.division ?? null,
  };
}
function groupKey(date: string, group: RevenueGroup) {
  if (group === "Day") return date;
  if (group === "Month") return date.slice(0, 7);
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - d.getDay());
  return localDate(d);
}
function defaultGroup(period: RevenuePeriod): RevenueGroup {
  return ["This Year", "Last Year", "All Time"].includes(period)
    ? "Month"
    : period === "This Quarter"
      ? "Week"
      : "Day";
}
function metric(current: number, previous: number): MonthlyMetric {
  return {
    current,
    previous,
    change: previous ? ((current - previous) / previous) * 100 : null,
  };
}
function sum(values: number[]) {
  return values.reduce((a, b) => a + Number(b || 0), 0);
}
function monthStart(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDate(d);
}
