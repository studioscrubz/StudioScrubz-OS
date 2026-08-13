import type { InvoiceWithRelations } from "@/types/invoice";
import type { PaymentMethod } from "@/types/payment";

export const REVENUE_PERIODS=["Today","This Week","This Month","Last Month","This Quarter","This Year","Last Year","All Time","Custom Range"] as const;
export type RevenuePeriod=(typeof REVENUE_PERIODS)[number];
export type RevenueGroup="Day"|"Week"|"Month";
export type RevenueDateRange={start:string|null;end:string|null;label:string};
export type RevenueSummary={collected:number;invoiced:number;outstanding:number;paidInvoices:number;openInvoices:number;averageInvoice:number;collectionRate:number|null;averagePayment:number};
export type RevenueDataPoint={key:string;label:string;amount:number};
export type ClientRevenueSummary={clientId:string;clientName:string;totalPaid:number;invoiceCount:number;paidInvoiceCount:number;outstanding:number};
export type ServiceRevenueSummary={service:string;collected:number;invoiceCount:number;averageInvoice:number};
export type DivisionRevenueSummary={division:"Residential"|"Commercial";collected:number;percentage:number;invoiceCount:number};
export type PaymentMethodSummary={method:PaymentMethod;total:number;count:number};
export type PastDueSummary={count:number;balance:number};
export type MonthlyMetric={current:number;previous:number;change:number|null};
export type MonthlyPerformance={collected:MonthlyMetric;invoicesIssued:MonthlyMetric;paymentsReceived:MonthlyMetric;outstanding:MonthlyMetric};
export type CompletedWorkValue={total:number;average:number;count:number};
export type RevenuePaymentRecord={id:string;paymentDate:string;amount:number;method:PaymentMethod;invoiceId:string;invoiceNumber:string;clientId:string;clientName:string;service:string;division:"Residential"|"Commercial"};
export type RevenueReport={range:RevenueDateRange;summary:RevenueSummary;payments:RevenuePaymentRecord[];invoices:InvoiceWithRelations[];overTime:RevenueDataPoint[];byClient:ClientRevenueSummary[];byService:ServiceRevenueSummary[];byDivision:DivisionRevenueSummary[];byMethod:PaymentMethodSummary[];outstandingInvoices:InvoiceWithRelations[];pastDue:PastDueSummary;recentPayments:RevenuePaymentRecord[];monthly:MonthlyPerformance;completedWork:CompletedWorkValue;topCustomers:ClientRevenueSummary[]};
