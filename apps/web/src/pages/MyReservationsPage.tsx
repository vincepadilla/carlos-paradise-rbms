import {
    useEffect,
    useRef,
    useState,
    type FormEvent,
    type ReactNode,
} from "react";
import type { User } from "../api";
import type { SavedReservation, Payment } from "../types/reservation";
import ReservationHeader from "../components/GuestHeader";
import { apiBaseUrl, reservationApi } from "../services/ReservationApi";
import { manilaToday, money } from "../utils/reservation";

type Reservation = SavedReservation & {
    opportunity?: { id: number; status: string } | null;
    extension_status?: string | null;
    extension_date?: string | null;
    extension_reason?: string | null;
    extension_message?: string | null;
    extension_access?: { enabled: boolean | number; agreed_deadline: string; consumed_at: string | null } | null;
};
type Tab = "active" | "pending" | "completed" | "cancelled";
const tabs: { key: Tab; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "pending", label: "Pending" },
    { key: "completed", label: "Completed" },
    { key: "cancelled", label: "Cancelled" },
];
const labels: Record<string, string> = {
    pending: "Pending Staff Review",
    queued: "Awaiting Reservation Opportunity",
    awaiting_deposit: "Awaiting Deposit",
    payment_review: "Receipt Under Review",
    confirmed: "Confirmed",
    completed: "Completed",
    cancelled: "Cancelled",
    rejected: "Dates Secured by Earlier Request",
    expired: "Deposit Period Expired",
    declined: "Declined",
    held: "Held for Review",
    reserved: "Reserved",
};
function category(status: string): Tab {
    if (status === "confirmed") return "active";
    if (status === "completed") return "completed";
    if (["cancelled", "expired", "declined"].includes(status)) return "cancelled";
    return "pending";
}
function longDate(value: string) {
    return new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        month: "long",
        day: "numeric",
        year: "numeric",
    }).format(new Date(value));
}
function time(value: string) {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Manila",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(new Date(value));
}
function parts(value: string) {
    const fields = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "long",
        day: "numeric",
    }).formatToParts(new Date(value));
    const field = (name: string) =>
        fields.find((part) => part.type === name)?.value || "";
    return { month: field("month"), day: field("day"), year: field("year") };
}
function dateRange(reservation: Reservation) {
    const start = parts(reservation.starts_at);
    const end = parts(reservation.ends_at);
    if (start.year === end.year && start.month === end.month) {
        return start.day === end.day
            ? `${start.month} ${start.day}, ${start.year}`
            : `${start.month} ${start.day}–${end.day}, ${start.year}`;
    }
    if (start.year === end.year) {
        return `${start.month} ${start.day} – ${end.month} ${end.day}, ${end.year}`;
    }
    return `${longDate(reservation.starts_at)} – ${longDate(reservation.ends_at)}`;
}
function duration(reservation: Reservation) {
    if (reservation.type === "day_tour") return "Day Tour";
    const dateKey = (value: string) =>
        new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(new Date(value));
    const nights = Math.max(
        0,
        Math.round(
            (Date.parse(`${dateKey(reservation.ends_at)}T00:00:00Z`) -
                Date.parse(`${dateKey(reservation.starts_at)}T00:00:00Z`)) /
            86400000,
        ),
    );
    return `${nights + 1} ${nights + 1 === 1 ? "day" : "days"} and ${nights} ${nights === 1 ? "night" : "nights"}`;
}
function deadlineLabel(reservation: Reservation, now: number) {
    if (!reservation.deadline) return "Not started";
    const difference = new Date(reservation.deadline).getTime() - now;
    if (!Number.isFinite(difference)) return "Deadline unavailable";
    if (difference <= 0) return "Payment period ended";
    const minutes = Math.ceil(difference / 60000);
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m remaining`;
}
function approvedAmount(reservation: Reservation) {
    return (reservation.payments || [])
        .filter((payment) => payment.status === "approved")
        .reduce((sum, payment) => sum + Number(payment.amount), 0);
}
function paymentStatus(reservation: Reservation) {
    if (!Array.isArray(reservation.payments))
        return "Payment details unavailable";
    const approved = approvedAmount(reservation);
    if (
        Number(reservation.deposit) > 0 &&
        approved >= Number(reservation.deposit)
    )
        return "Deposit Verified";
    if (reservation.payments.some((payment) => payment.status === "submitted"))
        return "Awaiting Review";
    if (approved > 0) return "Partially Verified";
    const latest = [...reservation.payments].sort(
        (a, b) => Number(b.id) - Number(a.id),
    )[0];
    if (latest?.status === "rejected") return "Receipt Rejected";
    if (latest?.status === "correction_requested") return "Correction Requested";
    return latest ? "Payment Status Unavailable" : "Not Yet Paid";
}
function availabilityStatus(reservation: Reservation, now: number) {
    if (reservation.status === "confirmed") return "Reservation Confirmed";
    if (reservation.status === "completed") return "Stay Completed";
    if (reservation.status === "payment_review") return "Held for Verification";
    if (["cancelled", "expired", "declined", "rejected"].includes(reservation.status))
        return "Request Closed";
    if (reservation.status === "awaiting_deposit") {
        if (reservation.opportunity === undefined)
            return "Opportunity details unavailable";
        return reservation.opportunity?.status === "active" &&
            !!reservation.deadline &&
            new Date(reservation.deadline).getTime() > now
            ? "Opportunity Active"
            : "Awaiting Staff Update";
    }
    return reservation.status === "queued"
        ? reservation.queue_position
            ? "Queue position " + reservation.queue_position
            : "Awaiting Opportunity"
        : "Pending Staff Review";
}
function Information({
    label,
    children,
    note,
}: {
    label: string;
    children: ReactNode;
    note?: string;
}) {
    return (
        <div className="flex min-h-[94px] min-w-0 flex-col items-start gap-[7px] border-b border-[#e3d9cb] px-6 py-5 sm:border-r sm:[&:nth-child(2n)]:border-r-0 lg:[&:nth-child(2n)]:border-r lg:[&:nth-child(3n)]:border-r-0">
            <span className="text-[9px] font-normal text-[#776f65]">{label}</span>
            <b className="text-xs font-semibold leading-relaxed wrap-anywhere">
                {children}
            </b>
            {note && <small className="text-[9px] text-[#776f65]">{note}</small>}
        </div>
    );
}

function paymentDate(value?: string | null, dateOnly = false) {
    if (!value) return "Not provided";
    // Date-only strings are calendar dates in Manila, not UTC timestamps.
    const parsed = new Date(
        /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00+08:00` : value,
    );
    if (!Number.isFinite(parsed.getTime())) return "Not provided";
    return new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        month: "short",
        day: "numeric",
        year: "numeric",
        ...(dateOnly ? {} : { hour: "numeric", minute: "2-digit", hour12: true }),
    }).format(parsed);
}
function PaymentHistory({ reservation }: { reservation: Reservation }) {
    const payments = Array.isArray(reservation.payments)
        ? [...reservation.payments].sort((a, b) => Number(b.id) - Number(a.id))
        : null;
    const validAmount = (payment: Payment) =>
        payment.amount != null &&
        payment.amount !== "" &&
        Number.isFinite(Number(payment.amount)) &&
        Number(payment.amount) > 0;
    const verified = (payments || [])
        .filter((p) => p.status === "approved" && validAmount(p))
        .reduce((sum, p) => sum + Number(p.amount), 0);
    const pending = (payments || [])
        .filter((p) => p.status === "submitted" && validAmount(p))
        .reduce((sum, p) => sum + Number(p.amount), 0);
    const total =
        reservation.total != null &&
            reservation.total !== "" &&
            Number.isFinite(Number(reservation.total))
            ? Number(reservation.total)
            : null;
    const statusNames: Record<string, string> = {
        approved: "Approved",
        submitted: "Under Review",
        rejected: "Rejected",
        correction_requested: "Correction Requested",
    };
    return (
        <section
            aria-label={`Payment history for ${reservation.reference}`}
            className="rounded-xl border border-[#e3d9cb] bg-[#fffdf8] p-4 md:p-5"
        >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="m-0 text-sm font-semibold">Payment Summary</h3>
                <span className="text-[10px] text-[#776f65]">
                    {payments === null
                        ? "Details unavailable"
                        : `${payments.length} ${payments.length === 1 ? "receipt" : "receipts"}`}
                </span>
            </div>
            {payments === null ? (
                <p className="m-0 text-xs text-[#776f65]">
                    Payment information was not returned by the server. Refresh your
                    reservations to try again.
                </p>
            ) : (
                <>
                    <dl className="mb-5 grid grid-cols-1 gap-3 rounded-lg bg-[#f6f1e7] p-4 sm:grid-cols-2 lg:grid-cols-4">
                        {[
                            [
                                "Reservation total",
                                total === null ? "Pending agreement" : money(total),
                            ],
                            ["Verified payments", money(verified)],
                            ["Under review", money(pending)],
                            ...(reservation.damage_total !== undefined ? [["Recorded damage charges", money(reservation.damage_total)]] : []),
                            [
                                "Remaining balance",
                                total === null
                                    ? "Pending agreement"
                                    : money(reservation.amount_due ?? Math.max(0, total - verified)),
                            ],
                        ].map(([label, value]) => (
                            <div key={label} className="min-w-0">
                                <dt className="mb-2 text-[10px] text-[#776f65]">{label}</dt>
                                <dd className="m-0 text-sm font-semibold wrap-anywhere">
                                    {value}
                                </dd>
                            </div>
                        ))}
                    </dl>
                    <p className="mb-4 text-[10px] leading-relaxed text-[#776f65]">
                        Only approved payments reduce the remaining balance. The refundable
                        security deposit is separate.
                    </p>
                    {!payments.length && (
                        <p className="m-0 text-xs text-[#776f65]">
                            No payment receipts have been submitted for this reservation.
                        </p>
                    )}
                    <div className="space-y-4">
                        {payments.map((payment) => (
                            <article
                                key={payment.id}
                                aria-label={`Payment ${payment.id}`}
                                className="rounded-lg border border-[#e3d9cb] p-4"
                            >
                                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="m-0 text-sm font-semibold">
                                            {validAmount(payment)
                                                ? money(payment.amount)
                                                : "Amount unavailable"}
                                        </p>
                                        <p className="mt-1 mb-0 text-[10px] text-[#776f65]">
                                            Payment #{payment.id} ·{" "}
                                            {payment.method || "Method not provided"}
                                        </p>
                                    </div>
                                    <span
                                        className={`rounded-full px-3 py-1.5 text-[9px] font-semibold ${payment.status === "approved" ? "bg-[#e8eee5] text-[#59754f]" : payment.status === "rejected" ? "bg-[#f7e6e3] text-[#a44b45]" : "bg-[#f6ecd7] text-[#805c27]"}`}
                                    >
                                        {statusNames[payment.status] ||
                                            payment.status?.replaceAll("_", " ") ||
                                            "Unknown"}
                                    </span>
                                </div>
                                <dl className="grid min-w-0 grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
                                    {[
                                        ["Reference number", payment.reference || "Not provided"],
                                        ["Payment method", payment.method || "Not provided"],
                                        ["Payment date", paymentDate(payment.payment_date, true)],
                                        ["Receipt submitted", paymentDate(payment.submitted_at)],
                                        ["Staff reviewed", paymentDate(payment.reviewed_at)],
                                    ].map(([label, value]) => (
                                        <div key={label} className="min-w-0">
                                            <dt className="mb-1.5 text-[10px] text-[#776f65]">
                                                {label}
                                            </dt>
                                            <dd className="m-0 leading-relaxed wrap-anywhere">
                                                {value}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                                {payment.review_note && (
                                    <div className="mt-4 rounded-lg bg-[#f6f1e7] p-3">
                                        <p className="mb-1 text-[10px] font-semibold">
                                            Staff review note
                                        </p>
                                        <p className="m-0 whitespace-pre-wrap text-xs leading-relaxed text-[#776f65] wrap-anywhere">
                                            {payment.review_note}
                                        </p>
                                    </div>
                                )}
                                {payment.status === "approved" ? (
                                    <a
                                        className="mt-4 inline-flex min-h-11 items-center text-xs font-semibold text-[#4c3425] underline"
                                        href={`${apiBaseUrl}/api/payments/${payment.id}/receipt`}
                                    >
                                        Download official receipt
                                    </a>
                                ) : (
                                    <p className="mt-4 mb-0 text-[10px] text-[#776f65]">
                                        Official receipt available after approval.
                                    </p>
                                )}
                            </article>
                        ))}
                    </div>
                </>
            )}
        </section>
    );
}

function PaymentHistoryDialog({
    reservation,
    onClose,
}: {
    reservation: Reservation;
    onClose: () => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const opener = document.activeElement;
        const originalOverflow = document.body.style.overflow;
        dialog.showModal();
        document.body.style.overflow = "hidden";
        return () => {
            if (dialog.open) dialog.close();
            document.body.style.overflow = originalOverflow;
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        };
    }, []);

    return (
        <dialog
            ref={dialogRef}
            aria-labelledby="payment-history-title"
            aria-describedby="payment-history-reference"
            onClose={(event) => {
                // StrictMode can replay setup after cleanup queued a close event.
                // Ignore that stale event when this dialog has already reopened.
                if (!event.currentTarget.open) onClose();
            }}
            onKeyDown={(event) => {
                if (event.key !== "Tab") return;
                const focusable = Array.from(
                    event.currentTarget.querySelectorAll<HTMLElement>(
                        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                    ),
                ).filter((element) => element.getClientRects().length > 0);
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (!first || !last) {
                    event.preventDefault();
                    event.currentTarget.focus();
                } else if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }}
            onClick={(event) => {
                if (event.target !== event.currentTarget) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                if (
                    event.clientX < bounds.left ||
                    event.clientX > bounds.right ||
                    event.clientY < bounds.top ||
                    event.clientY > bounds.bottom
                ) {
                    event.currentTarget.close();
                }
            }}
            className="m-auto max-h-[88dvh] w-[calc(100%-2rem)] max-w-[960px] overflow-y-auto rounded-2xl border border-[#e3d9cb] bg-[#fffdf8] p-0 font-sans text-[#2d261f] shadow-2xl backdrop:bg-[#2d261f]/50 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[#b08a52] [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-2 [&_a:focus-visible]:outline-[#b08a52]"
        >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#e3d9cb] bg-[#fffdf8] px-5 py-5 md:px-6">
                <div className="min-w-0">
                    <h2 id="payment-history-title" className="m-0 text-xl font-semibold">
                        Payment History
                    </h2>
                    <p
                        id="payment-history-reference"
                        className="mt-2 mb-0 text-xs text-[#776f65] wrap-anywhere"
                    >
                        {reservation.reference}
                    </p>
                </div>
                <button
                    type="button"
                    autoFocus
                    aria-label="Close payment history"
                    onClick={() => dialogRef.current?.close()}
                    className="grid size-10 shrink-0 place-items-center rounded-lg border border-[#e3d9cb] bg-[#f6f1e7] text-xl text-[#4c3425] hover:bg-[#eee6d8]"
                >
                    ×
                </button>
            </header>
            <div className="p-4 md:p-6">
                <PaymentHistory reservation={reservation} />
            </div>
            <footer className="flex justify-end border-t border-[#e3d9cb] px-5 py-4 md:px-6">
                <button
                    type="button"
                    onClick={() => dialogRef.current?.close()}
                    className="min-h-11 rounded-lg bg-[#4c3425] px-6 py-3 text-xs font-semibold text-white hover:bg-[#6e4b35]"
                >
                    Close
                </button>
            </footer>
        </dialog>
    );
}

function ExtensionRequestDialog({
    reservation,
    onClose,
    onSubmitted,
}: {
    reservation: Reservation;
    onClose: () => void;
    onSubmitted: (reservation: Reservation, message: string) => void;
}) {
    const [reason, setReason] = useState("");
    const [requestedDate, setRequestedDate] = useState("");
    const [message, setMessage] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const tomorrow = new Date(
        Date.parse(manilaToday() + "T00:00:00Z") + 86400000,
    )
        .toISOString()
        .slice(0, 10);
    const checkinDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(reservation.starts_at));
    const deadlineDate = reservation.deadline
        ? new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Manila",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
          }).format(new Date(reservation.deadline))
        : tomorrow;
    const earliestDate = deadlineDate > tomorrow ? deadlineDate : tomorrow;
    const lastStayDate = new Date(
        Date.parse(checkinDate + "T00:00:00Z") - 86400000,
    )
        .toISOString()
        .slice(0, 10);
    const agreedDate = reservation.extension_access?.agreed_deadline?.slice(0, 10);
    const latestDate = agreedDate && agreedDate < lastStayDate ? agreedDate : lastStayDate;
    const deadlineIsActive = Boolean(
        reservation.deadline &&
            new Date(reservation.deadline).getTime() > Date.now(),
    );
    const blockingMessage =
        reservation.extension_status === "pending"
            ? "An extension request is already pending for this reservation."
            : !reservation.extension_access?.enabled
              ? "Contact the Admin for extension authorization before requesting another payment date."
            : reservation.status !== "awaiting_deposit"
              ? "A deposit opportunity must be active before you can request a deadline extension."
              : !deadlineIsActive
                ? "Your payment window has ended. Contact the resort to ask about a staff-approved extension."
                : earliestDate > latestDate
                  ? "There is no valid extension date before this reservation's check-in time."
                  : "";

    useEffect(() => {
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = originalOverflow;
        };
    }, []);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitError("");

        if (blockingMessage) {
            setSubmitError(blockingMessage);
            return;
        }

        if (reason.trim().length < 3) {
            setSubmitError("Please explain why you need additional time.");
            return;
        }

        if (!requestedDate || requestedDate < earliestDate) {
            setSubmitError(
                "Requested payment date must extend the current deadline.",
            );
            return;
        }

        if (requestedDate > latestDate) {
            setSubmitError("Requested payment date must be before check-in.");
            return;
        }

        setSubmitting(true);
        try {
            const response = await reservationApi<{
                reservation: Reservation;
                message: string;
            }>("/reservations/" + reservation.id + "/extension", "POST", {
                reason: reason.trim(),
                requested_date: requestedDate,
                message: message.trim() || null,
            });

            if (!response.reservation)
                throw new Error("The server did not return the updated reservation.");

            onSubmitted(
                response.reservation,
                response.message || "Your extension request was submitted.",
            );
            onClose();
        } catch (cause) {
            setSubmitError(
                cause instanceof Error
                    ? cause.message
                    : "Unable to submit the extension request.",
            );
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#2d261f]/55 p-4 font-sans text-[#2d261f]">
            <div className="flex min-h-full items-center justify-center">
                <section
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="extension-request-title"
                    aria-describedby="extension-request-description"
                    className="max-h-[90dvh] w-full max-w-[620px] overflow-y-auto rounded-2xl border border-[#e3d9cb] bg-[#fffdf8] shadow-2xl"
                >
                    <form onSubmit={submit}>
                <header className="border-b border-[#e3d9cb] px-5 py-5 sm:px-7 sm:py-6">
                    <span className="mb-2 block text-[9px] font-bold uppercase tracking-[0.18em] text-[#b08a52]">
                        Deposit Payment
                    </span>
                    <h2
                        id="extension-request-title"
                        className="m-0 text-2xl font-normal tracking-[-0.035em]"
                    >
                        Request Deadline Extension
                    </h2>
                    <p
                        id="extension-request-description"
                        className="mt-3 mb-0 text-xs leading-relaxed text-[#776f65]"
                    >
                        This request will be reviewed by an Admin or Owner. Your
                        actual deposit deadline remains unchanged until approval.
                    </p>
                </header>

                <div className="space-y-5 px-5 py-6 sm:px-7">
                    {blockingMessage && (
                        <p
                            role="status"
                            className="m-0 rounded-lg border border-[#e4cfaa] bg-[#fff6df] px-4 py-3 text-xs text-[#73572e]"
                        >
                            {blockingMessage}
                        </p>
                    )}
                    {submitError && (
                        <p
                            role="alert"
                            className="m-0 rounded-lg border border-[#e7bbb6] bg-[#f7e6e3] px-4 py-3 text-xs text-[#a44b45]"
                        >
                            {submitError}
                        </p>
                    )}

                    <label className="block text-xs font-semibold">
                        Reason for requesting an extension
                        <span className="ml-1 text-[#a44b45]">*</span>
                        <textarea
                            autoFocus
                            required
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder="Explain why you need additional time."
                            maxLength={2000}
                            className="mt-2 min-h-28 w-full resize-y rounded-lg border border-[#e3d9cb] bg-white px-4 py-3 text-sm font-normal text-[#2d261f] outline-none placeholder:text-[#a9a198] focus:border-[#b08a52] focus:ring-2 focus:ring-[#b08a52]/15"
                        />
                    </label>

                    <label className="block text-xs font-semibold">
                        Requested date of payment
                        <span className="ml-1 text-[#a44b45]">*</span>
                        <input
                            required
                            type="date"
                            value={requestedDate}
                            min={earliestDate}
                            max={latestDate}
                            placeholder="dd/mm/yyyy"
                            onChange={(event) => setRequestedDate(event.target.value)}
                            className="mt-2 min-h-12 w-full rounded-lg border border-[#e3d9cb] bg-white px-4 py-3 text-sm font-normal text-[#2d261f] outline-none focus:border-[#b08a52] focus:ring-2 focus:ring-[#b08a52]/15"
                        />
                        <small className="mt-1.5 block font-normal text-[#776f65]">
                            dd/mm/yyyy
                        </small>
                    </label>

                    <label className="block text-xs font-semibold">
                        Optional message to Admin/Owner
                        <textarea
                            value={message}
                            onChange={(event) => setMessage(event.target.value)}
                            placeholder="Add any supporting information."
                            maxLength={2000}
                            className="mt-2 min-h-24 w-full resize-y rounded-lg border border-[#e3d9cb] bg-white px-4 py-3 text-sm font-normal text-[#2d261f] outline-none placeholder:text-[#a9a198] focus:border-[#b08a52] focus:ring-2 focus:ring-[#b08a52]/15"
                        />
                    </label>
                </div>

                <footer className="flex flex-col-reverse gap-3 border-t border-[#e3d9cb] bg-[#f6f1e7] px-5 py-4 sm:flex-row sm:justify-end sm:px-7">
                    <button
                        type="button"
                        disabled={submitting}
                        onClick={onClose}
                        className="min-h-11 rounded-lg border border-[#e3d9cb] bg-[#fffdf8] px-6 py-3 text-xs font-semibold text-[#4c3425] hover:bg-white disabled:cursor-wait disabled:opacity-60"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={submitting || Boolean(blockingMessage)}
                        className="min-h-11 rounded-lg bg-[#4c3425] px-6 py-3 text-xs font-semibold text-white hover:bg-[#6e4b35] disabled:cursor-wait disabled:opacity-60"
                    >
                        {submitting ? "Submitting…" : "Submit Request"}
                    </button>
                </footer>
                    </form>
                </section>
            </div>
        </div>
    );
}

export default function MyReservationsPage({
    user,
    rows,
    error,
    onReservations,
    onMakeReservation,
    onSelect,
    onDashboard,
    onProfile,
    onHelp,
    focusReservationId,
}: {
    user: User;
    focusReservationId?: number | null;
    onDashboard?: () => void;
    onProfile?: () => void;
    onHelp?: () => void;
    rows: SavedReservation[];
    error: string;
    onReservations: () => void;
    onMakeReservation: () => void;
    onSelect: (reservation: SavedReservation) => void;
}) {
    const [reservations, setReservations] = useState<Reservation[]>(rows);
    const [tab, setTab] = useState<Tab>(() =>
        focusReservationId != null &&
            rows.some((row) => row.id === focusReservationId)
            ? category(rows.find((row) => row.id === focusReservationId)!.status)
            : rows.some((row) => category(row.status) === "pending")
                ? "pending"
                : rows.some((row) => row.status === "confirmed")
                    ? "active"
                    : rows.some((row) => row.status === "completed")
                        ? "completed"
                        : rows.length
                            ? "cancelled"
                            : "pending",
    );
    const [now, setNow] = useState(Date.now());
    const [refreshError, setRefreshError] = useState("");
    const [historyReservationId, setHistoryReservationId] = useState<
        number | null
    >(null);
    const [extensionReservationId, setExtensionReservationId] = useState<
        number | null
    >(null);
    const [extensionNotice, setExtensionNotice] = useState("");
    const historyReservation = reservations.find(
        (row) => row.id === historyReservationId,
    );
    const extensionReservation = reservations.find(
        (row) => row.id === extensionReservationId,
    );
    useEffect(() => setReservations(rows), [rows]);
    useEffect(() => {
        if (focusReservationId == null) return;
        const reservation = rows.find((row) => row.id === focusReservationId);
        if (reservation) setTab(category(reservation.status));
    }, [focusReservationId, rows]);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        async function refresh() {
            try {
                const data = await reservationApi<{
                    reservations: (Reservation & { user_id: number })[];
                }>("/reservations", "GET", undefined, controller.signal);
                if (!Array.isArray(data.reservations))
                    throw new Error("The reservation response is incomplete.");
                if (active) {
                    setReservations(
                        data.reservations.filter(
                            (row) => Number(row.user_id) === Number(user.id),
                        ),
                    );
                    setRefreshError("");
                }
            } catch (cause) {
                if (active && !controller.signal.aborted)
                    setRefreshError(
                        cause instanceof Error
                            ? cause.message
                            : "Unable to refresh reservations.",
                    );
            } finally {
                if (active) timer = setTimeout(() => void refresh(), 15000);
            }
        }
        void refresh();
        return () => {
            active = false;
            controller.abort();
            clearTimeout(timer);
        };
    }, [user.id]);
    const visible = reservations.filter(
        (reservation) => category(reservation.status) === tab,
    );
    const primary =
        "inline-flex min-h-[44px] items-center justify-center rounded-[9px] border border-[#4c3425] bg-[#4c3425] px-[18px] py-3 text-xs font-bold text-white shadow-[0_8px_18px_rgba(76,52,37,0.12)] transition hover:bg-[#6e4b35] disabled:cursor-not-allowed disabled:opacity-50";
    const secondary =
        "inline-flex min-h-[44px] items-center justify-center rounded-[9px] border border-[#e3d9cb] bg-[#fffdf8] px-[18px] py-3 text-xs font-semibold text-[#4c3425] transition hover:bg-[#f6f1e7] disabled:cursor-not-allowed disabled:opacity-50";
    return (
        <div className="min-h-screen bg-[#f6f1e7] font-sans text-[#2d261f] [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-[#b08a52]">
            <ReservationHeader
                user={user}
                activePage="reservations"
                onReservations={onReservations}
                onMakeReservation={onMakeReservation}
                onDashboard={onDashboard}
                onProfile={onProfile}
                onHelp={onHelp}
            />
            <main className="mx-auto max-w-[1356px] px-4 py-7 md:px-[34px]">
                <div className="mb-7">
                    <h1 className="m-0 text-[28px] font-normal leading-tight tracking-[-0.045em]">
                        My Reservations
                    </h1>
                    <p className="mt-1.5 mb-0 text-xs leading-relaxed text-[#776f65]">
                        Your reservation status, payment progress, and requested stay in one
                        place.
                    </p>
                </div>
                <div
                    role="tablist"
                    aria-label="Reservation categories"
                    className="mb-[17px] flex gap-6 overflow-x-auto border-b border-[#e3d9cb]"
                >
                    {tabs.map(({ key, label }, index) => (
                        <button
                            key={key}
                            type="button"
                            role="tab"
                            id={`reservation-tab-${key}`}
                            aria-selected={tab === key}
                            aria-controls={`reservation-panel-${key}`}
                            tabIndex={tab === key ? 0 : -1}
                            onClick={() => setTab(key)}
                            onKeyDown={(event) => {
                                if (
                                    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                                        event.key,
                                    )
                                )
                                    return;
                                event.preventDefault();
                                const next =
                                    event.key === "Home"
                                        ? 0
                                        : event.key === "End"
                                            ? tabs.length - 1
                                            : (index +
                                                (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                                            tabs.length;
                                setTab(tabs[next].key);
                                document
                                    .getElementById(`reservation-tab-${tabs[next].key}`)
                                    ?.focus();
                            }}
                            className={`shrink-0 border-0 border-b! bg-transparent px-0 pt-2.5 pb-3 text-xs ${tab === key ? "border-[#4c3425]! font-semibold text-[#2d261f]" : "border-transparent! font-normal text-[#776f65]"}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                {(error || refreshError) && (
                    <p
                        role="alert"
                        className="mb-4 rounded-lg bg-[#f7e6e3] p-4 text-xs text-[#a44b45]"
                    >
                        {error || refreshError}
                    </p>
                )}
                {extensionNotice && (
                    <div
                        role="status"
                        className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-[#cddbc8] bg-[#e8eee5] p-4 text-xs text-[#59754f]"
                    >
                        <span>{extensionNotice}</span>
                        <button
                            type="button"
                            aria-label="Dismiss notification"
                            onClick={() => setExtensionNotice("")}
                            className="border-0 bg-transparent text-lg text-[#59754f]"
                        >
                            ×
                        </button>
                    </div>
                )}
                <div
                    role="tabpanel"
                    id={`reservation-panel-${tab}`}
                    aria-labelledby={`reservation-tab-${tab}`}
                >
                    {!visible.length && (
                        <section className="rounded-xl border border-[#e3d9cb] bg-[#fffdf8] px-5 py-12 text-center">
                            <h2 className="mb-2 text-xl font-medium">
                                No {tab} reservations
                            </h2>
                            <p className="mb-5 text-sm text-[#776f65]">
                                Your reservations will appear here when their status matches
                                this category.
                            </p>
                            <button
                                type="button"
                                className={primary}
                                onClick={onMakeReservation}
                            >
                                Make a Reservation
                            </button>
                        </section>
                    )}
                    {visible.map((reservation) => {
                        const submitted = reservation.payments?.some(
                            (payment) => payment.status === "submitted",
                        );
                        const payable =
                            reservation.status === "awaiting_deposit" &&
                            reservation.opportunity?.status === "active" &&
                            !!reservation.deadline &&
                            new Date(reservation.deadline).getTime() > now &&
                            Array.isArray(reservation.payments) &&
                            !submitted &&
                            Number(reservation.deposit) > approvedAmount(reservation);
                        const tone =
                            reservation.status === "confirmed" ||
                                reservation.status === "completed"
                                ? "bg-[#e8eee5] text-[#59754f]"
                                : reservation.status === "payment_review"
                                    ? "bg-[#e6efed] text-[#527a76]"
                                    : ["cancelled", "expired", "declined"].includes(
                                        reservation.status,
                                    )
                                        ? "bg-[#f7e6e3] text-[#a44b45]"
                                        : "bg-[#f6ecd7] text-[#805c27]";
                        return (
                            <article
                                key={reservation.id}
                                className="mb-6 overflow-hidden rounded-xl border border-[#e3d9cb] bg-[#fffdf8]"
                            >
                                <header className="flex flex-col items-start justify-between gap-4 p-6 sm:flex-row">
                                    <div>
                                        <span className="mb-2.5 block text-[9px] font-bold uppercase tracking-[0.17em] text-[#b08a52]">
                                            My Reservation
                                        </span>
                                        <h2 className="m-0 text-[23px] font-normal leading-tight tracking-[-0.04em]">
                                            {dateRange(reservation)}
                                        </h2>
                                        <p className="mt-1.5 mb-0 text-xs text-[#776f65]">
                                            {reservation.reference} · {duration(reservation)}
                                        </p>
                                    </div>
                                    <span
                                        className={`shrink-0 rounded-full px-2.5 py-1.5 text-[8px] font-semibold uppercase tracking-wide ${tone}`}
                                    >
                                        {labels[reservation.status] ||
                                            reservation.status.replaceAll("_", " ")}
                                    </span>
                                </header>
                                <div className="grid grid-cols-1 border-t border-[#e3d9cb] sm:grid-cols-2 lg:grid-cols-3">
                                    <Information
                                        label="Reservation status"
                                        note="Your request only"
                                    >
                                        {labels[reservation.status] ||
                                            reservation.status.replaceAll("_", " ")}
                                    </Information>
                                    <Information label="Availability status">
                                        {availabilityStatus(reservation, now)}
                                    </Information>
                                    <Information label="Payment status">
                                        {paymentStatus(reservation)}
                                    </Information>
                                    <Information label="Deposit deadline">
                                        {["awaiting_deposit", "held"].includes(reservation.status)
                                            ? deadlineLabel(reservation, now)
                                            : reservation.status === "payment_review"
                                                ? "Receipt under review"
                                                : reservation.deadline
                                                    ? `${longDate(reservation.deadline)} · ${time(reservation.deadline)}`
                                                    : "Not started"}
                                    </Information>
                                    <Information label="Check-in">
                                        {longDate(reservation.starts_at)} ·{" "}
                                        {time(reservation.starts_at)}
                                    </Information>
                                    <Information label="Check-out">
                                        {longDate(reservation.ends_at)} ·{" "}
                                        {time(reservation.ends_at)}
                                    </Information>
                                    <Information label="Reservation Type">
                                        {reservation.type === "day_tour"
                                            ? "Day Tour"
                                            : "Overnight Stay"}
                                    </Information>
                                    {reservation.partial_payment_authorized && <Information label="Partial-payment terms">{reservation.partial_payment_terms}</Information>}
                                </div>
                                <div className="space-y-4 px-4 pt-[15px] pb-6 md:px-6">
                                    {reservation.status === "awaiting_deposit" && (
                                        <div className="flex flex-col items-start justify-between gap-4 rounded-[9px] bg-[#e6efed] p-4 sm:flex-row sm:items-center">
                                            <div>
                                                <span className="mb-1 block text-[8px] text-[#776f65]">
                                                    Deposit Deadline
                                                </span>
                                                <b className="block text-xs font-semibold">
                                                    {deadlineLabel(reservation, now)}
                                                </b>
                                                <small className="mt-1 block text-[8px] text-[#776f65]">
                                                    Your original deadline continues even if you leave the
                                                    payment page.
                                                </small>
                                            </div>
                                            <button
                                                type="button"
                                                className={primary}
                                                disabled={!payable}
                                                onClick={() => onSelect(reservation)}
                                            >
                                                {payable
                                                    ? `Pay ${money(reservation.deposit)} Deposit`
                                                    : "Payment Unavailable"}
                                            </button>
                                        </div>
                                    )}
                                    {reservation.status === "payment_review" && (
                                        <div className="flex flex-col items-start justify-between gap-4 rounded-[9px] bg-[#e6efed] p-4 sm:flex-row sm:items-center">
                                            <div>
                                                <b className="text-xs font-semibold">
                                                    Your receipt is under review
                                                </b>
                                                <p className="mt-1 mb-0 text-[10px] text-[#776f65]">
                                                    Staff must verify your transfer before confirming the
                                                    reservation.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                    <section className="flex flex-col items-start justify-between gap-4 rounded-xl border border-[#e3d9cb] bg-[#f6f1e7] p-4 sm:flex-row sm:items-center">
                                        <div>
                                            <h3 className="m-0 text-sm font-semibold">
                                                Payment History
                                            </h3>
                                            <p className="mt-1.5 mb-0 text-xs text-[#776f65]">
                                                {Array.isArray(reservation.payments)
                                                    ? `${reservation.payments.length} ${reservation.payments.length === 1 ? "receipt" : "receipts"} · ${paymentStatus(reservation)}`
                                                    : "Payment details unavailable"}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            aria-haspopup="dialog"
                                            className={secondary}
                                            onClick={() => setHistoryReservationId(reservation.id)}
                                        >
                                            View Payment History
                                        </button>
                                    </section>
                                    {["pending", "queued", "awaiting_deposit"].includes(
                                        reservation.status,
                                    ) && (
                                            <section className="rounded-[10px] border border-[#e4cfaa] bg-[#fff6df] p-[18px]">
                                                <span className="mb-2 block text-[9px] font-bold uppercase tracking-[0.17em] text-[#9a7138]">
                                                    Need More Time?
                                                </span>
                                                <h3 className="m-0 text-sm font-normal text-[#4c3425]">
                                                    Contact the Admin or Owner
                                                </h3>
                                                <p className="mt-1.5 mb-0 max-w-[720px] text-[10px] leading-relaxed text-[#73572e]">
                                                    {reservation.extension_access?.enabled ? <>The Admin authorized a request up to {reservation.extension_access.agreed_deadline.slice(0, 10)}. Your actual deposit deadline changes only after approval.</> : <>To request more time for your deposit payment,
                                                    please contact the resort Admin or Owner first.
                                                    The deadline extension request option will remain
                                                    hidden until staff makes it available.</>}
                                                </p>
                                                {reservation.status === "awaiting_deposit" && Boolean(reservation.extension_access?.enabled) && <button type="button" className={`${secondary} mt-3`} onClick={() => setExtensionReservationId(reservation.id)}>Request Deadline Extension</button>}
                                            </section>
                                        )}
                                    {![
                                        "awaiting_deposit",
                                        "payment_review",
                                        "confirmed",
                                    ].includes(reservation.status) && (
                                            <button
                                                type="button"
                                                className="border-0 bg-transparent p-0 text-xs font-semibold text-[#4c3425] underline"
                                                onClick={() => onSelect(reservation)}
                                            >
                                                View Reservation Details
                                            </button>
                                        )}
                                </div>
                            </article>
                        );
                    })}
                </div>
            </main>
            {historyReservation && (
                <PaymentHistoryDialog
                    key={historyReservation.id}
                    reservation={historyReservation}
                    onClose={() => setHistoryReservationId(null)}
                />
            )}
            {extensionReservation && (
                <ExtensionRequestDialog
                    key={extensionReservation.id}
                    reservation={extensionReservation}
                    onClose={() => setExtensionReservationId(null)}
                    onSubmitted={(updatedReservation, message) => {
                        setReservations((current) =>
                            current.map((reservation) =>
                                reservation.id === updatedReservation.id
                                    ? updatedReservation
                                    : reservation,
                            ),
                        );
                        setExtensionNotice(message);
                    }}
                />
            )}
        </div>
    );
}
