import type { AdminReservation, Paginated } from "./admin";
import type { Payment } from "./reservation";

export type ReceiptMetadata = { available: boolean; mime: string | null };
export type PaymentReviewData = {
    reservation: AdminReservation;
    receipts: Record<string, ReceiptMetadata>;
    payment_methods: string[];
    can_approve_payments: boolean;
    editing: null | {
        pricing: Record<'base' | 'holiday_fee' | 'extra_fee' | 'cleaning_fee' | 'bonfire' | 'charcoal' | 'liquor' | 'other', string>;
        discount: { type: 'none' | 'percentage' | 'fixed'; value: string; justification: string | null };
    };
};
export type PendingPaymentReview = { reservation: AdminReservation; payment: Payment };
export type DepositPaymentStatus = "verified" | "not_paid" | "awaiting_review" | "rejected";
export type DepositPaymentRecord = {
    reservation_id: number;
    reservation_reference: string;
    guest_name: string;
    starts_at: string;
    ends_at: string;
    payment_method: string | null;
    total_submitted: string | null;
    submitted_at: string | null;
    status: DepositPaymentStatus;
    latest_payment_id: number | null;
};
export type DepositPaymentRecordList = Paginated<DepositPaymentRecord> & {
    from: number | null;
    to: number | null;
    filters: {
        statuses: Array<{ value: DepositPaymentStatus; label: string }>;
        methods: string[];
    };
};
