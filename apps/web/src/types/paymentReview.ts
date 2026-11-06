import type { AdminReservation } from "./admin";
import type { Payment } from "./reservation";

export type ReceiptMetadata = { available: boolean; mime: string | null };
export type PaymentReviewData = { reservation: AdminReservation; receipts: Record<string, ReceiptMetadata> };
export type PendingPaymentReview = { reservation: AdminReservation; payment: Payment };
