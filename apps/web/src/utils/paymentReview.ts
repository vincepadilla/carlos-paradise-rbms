import type { AdminReservation } from "../types/admin";
import type { Payment } from "../types/reservation";

export const paymentReviewLabel = (status: string) => ({ submitted: "Awaiting Review", approved: "Verified", rejected: "Rejected" })[status] ?? status;
export function paymentCents(value: string): number | null {
    const amount = Number(value);
    return value.trim() && Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
}
export function paymentDifference(required: string, submitted: string): number | null {
    const expected = paymentCents(required), actual = paymentCents(submitted);
    return expected === null || actual === null ? null : (actual - expected) / 100;
}
export const isReviewablePayment = (reservation: AdminReservation, payment: Payment) => reservation.status === "payment_review" && payment.status === "submitted";
export function pendingDeposits(reservations: AdminReservation[]) {
    return reservations.flatMap(reservation => (reservation.payments ?? []).filter(payment => isReviewablePayment(reservation, payment)).map(payment => ({ reservation, payment })))
        .sort((a, b) => b.payment.id - a.payment.id);
}
export function rejectionValidation(reason: string): string | null {
    return reason.trim().length < 3 || reason.trim().length > 1000 ? "Enter a rejection reason between 3 and 1,000 characters." : null;
}
