import { useCallback } from "react";
import { useParams } from "react-router";
import AdminResource from "../../components/admin/AdminResource";
import PaymentReview from "../../components/admin/payment-review/PaymentReview";
import { AdminApi } from "../../services/AdminApi";

export default function AdminPaymentReviewPage() {
    const { reservationId = "" } = useParams();
    const load = useCallback((signal: AbortSignal) => AdminApi.paymentReview(reservationId, signal), [reservationId]);
    if (!/^[1-9]\d*$/.test(reservationId) || !Number.isSafeInteger(Number(reservationId))) return <p role="alert">Invalid reservation ID.</p>;
    return <AdminResource key={reservationId} load={load} showRefresh={false}>{data => <PaymentReview key={reservationId} initialData={data} />}</AdminResource>;
}
