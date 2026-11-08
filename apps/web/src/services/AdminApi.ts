import { reservationApi, ReservationApiError } from "./ReservationApi";
import type { AdminGuest, AdminGuestDetails, AdminGuestUpdate, AdminReservation, AdminReservationList, AvailabilityBlock, Paginated } from "../types/admin";
import type { CalendarData } from "../types/calendar";
import type { ReservationDetailResponse, ReservationEdit } from "../types/reservationDetails";
import type { DepositPaymentRecordList, PaymentReviewData, PendingPaymentReview } from "../types/paymentReview";

import type { OcularVisit, OcularVisitInput, OcularVisitUpdate } from '../types/calendar';

async function readRecord<T>(path: string, notFoundMessage: string, signal: AbortSignal): Promise<T> {
    try {
        return await reservationApi<T>(path, "GET", undefined, signal);
    } catch (cause) {
        if (cause instanceof ReservationApiError && cause.status === 404) {
            throw new ReservationApiError(notFoundMessage, 404);
        }
        throw cause;
    }
}

// Reuse the reservation transport, cookies, configuration and server workflow.
export const AdminApi = {
    updateReservation: (id: number, data: ReservationEdit) =>
        reservationApi<ReservationDetailResponse>(`/admin/reservations/${id}`, "PATCH", data),
    completeReservation: (id: number, revision: number) =>
        reservationApi<ReservationDetailResponse>(`/admin/reservations/${id}/complete`, "POST", { revision }),
    grantExtensionAccess: (id: number, revision: number, agreed_deadline: string) =>
        reservationApi<ReservationDetailResponse>(`/admin/reservations/${id}/extension-access`, "POST", { revision, agreed_deadline }),
    revokeExtensionAccess: (id: number, revision: number) =>
        reservationApi<ReservationDetailResponse>(`/admin/reservations/${id}/extension-access`, "DELETE", { revision }),
    paymentReviews: (page: number, search: string, status: string, method: string, signal: AbortSignal) =>
        reservationApi<DepositPaymentRecordList>(`/admin/payment-reviews?${new URLSearchParams({
            scope: "all",
            page: String(page),
            ...(search ? { search } : {}),
            ...(status ? { status } : {}),
            ...(method ? { method } : {}),
        })}`, "GET", undefined, signal),
    pendingPaymentPreview: (signal: AbortSignal) =>
        reservationApi<Paginated<PendingPaymentReview>>("/admin/payment-reviews?per_page=2", "GET", undefined, signal),
    paymentReview: (id: string, signal: AbortSignal) =>
        readRecord<PaymentReviewData>(`/admin/reservations/${encodeURIComponent(id)}/payment-review`, "Reservation not found.", signal),
    reviewPayment: (reservationId: number, paymentId: number, decision: "approved" | "rejected", note: string) =>
        reservationApi(`/admin/reservations/${reservationId}/payments/${paymentId}/review`, "POST", { decision, note }),
    createOcularVisit: (data: OcularVisitInput) =>
        reservationApi<{ ocular_visit: OcularVisit }>('/admin/ocular-visits', 'POST', data),
    ocularVisit: (id: number, signal?: AbortSignal) =>
        reservationApi<{ ocular_visit: OcularVisit }>(`/admin/ocular-visits/${id}`, 'GET', undefined, signal),
    updateOcularVisit: (id: number, data: OcularVisitUpdate) =>
        reservationApi<{ ocular_visit: OcularVisit }>(`/admin/ocular-visits/${id}`, 'PATCH', data),
    approveOcularVisit: (id: number, revision: number) =>
        reservationApi<{ ocular_visit: OcularVisit }>(`/admin/ocular-visits/${id}/approve`, 'POST', { revision }),
    cancelOcularVisit: (id: number, revision: number) =>
        reservationApi<{ ocular_visit: OcularVisit }>(`/admin/ocular-visits/${id}/cancel`, 'POST', { revision }),
    calendar: (start: string, end: string, signal: AbortSignal) =>
        reservationApi<CalendarData>(`/admin/calendar?${new URLSearchParams({ start, end })}`, "GET", undefined, signal),
    createBlock: (date: string, reason: string) =>
        reservationApi<{ block: AvailabilityBlock }>("/admin/availability-blocks", "POST", { date, reason }),
    updateBlock: (id: number, reason: string) =>
        reservationApi<{ block: AvailabilityBlock }>(`/admin/availability-blocks/${id}`, "PATCH", { reason }),
    releaseBlock: (id: number) =>
        reservationApi<{ message: string }>(`/admin/availability-blocks/${id}/release`, "POST"),
    reservations: (signal: AbortSignal) =>
        reservationApi<{ reservations: AdminReservation[] }>("/reservations", "GET", undefined, signal),
    reservationList: (page: number, search: string, status: string, type: string, signal: AbortSignal) =>
        reservationApi<AdminReservationList>(`/admin/reservations?${new URLSearchParams({
            page: String(page),
            ...(search ? { search } : {}),
            ...(status ? { status } : {}),
            ...(type ? { type } : {}),
        })}`, "GET", undefined, signal),
    reservation: (id: string, signal: AbortSignal) =>
        readRecord<ReservationDetailResponse>(`/reservations/${encodeURIComponent(id)}`, "Reservation not found.", signal),
    agreeReservationTotal: (id: number, total: string) =>
        reservationApi(`/reservations/${id}/terms`, "PATCH", { total }),
    reviewExtension: (id: number, decision: "approved" | "rejected") =>
        reservationApi(`/reservations/${id}/extension/review`, "POST", { decision }),
    guests: (page: number, search: string, signal: AbortSignal) =>
        reservationApi<Paginated<AdminGuest>>(`/admin/guests?${new URLSearchParams({ page: String(page), ...(search ? { search } : {}) })}`, "GET", undefined, signal),
    guest: (id: string, signal: AbortSignal) =>
        readRecord<AdminGuestDetails>(`/admin/guests/${encodeURIComponent(id)}`, "Guest not found.", signal),
    updateGuest: (id: number, data: AdminGuestUpdate) =>
        reservationApi<AdminGuestDetails>("/admin/guests/" + id, "PATCH", data),
    blocks: (page: number, signal: AbortSignal) =>
        reservationApi<Paginated<AvailabilityBlock>>(`/admin/availability-blocks?page=${page}`, "GET", undefined, signal),
};
