import { useEffect, useState } from "react";
import type { User } from "../api";
import type { SavedReservation } from "../types/reservation";
import GuestHeader from "../components/GuestHeader";
import { Icon } from "../components/reservations/ReservationUI";
import { reservationApi } from "../services/ReservationApi";
import { money } from "../utils/reservation";

type Booking = SavedReservation & {
    user_id: number;
    adults?: number | string;
    children?: number | string;
    pets?: number | string;
    opportunity?: { id: number; status: string } | null;
};
const names: Record<string, string> = {
    pending: "Pending Staff Review",
    queued: "Awaiting Opportunity",
    awaiting_deposit: "Awaiting Deposit",
    payment_review: "Receipt Under Review",
    confirmed: "Confirmed",
    completed: "Completed",
    expired: "Deposit Period Ended",
    cancelled: "Cancelled",
    declined: "Declined",
    held: "Held for Review",
    reserved: "Reserved",
};
const closed = ["cancelled", "expired", "declined", "completed"];
function date(value: string) {
    return new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        month: "long",
        day: "numeric",
        year: "numeric",
    }).format(new Date(value));
}
function part(value: string, field: "day" | "month" | "year") {
    return (
        new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Manila",
            day: "numeric",
            month: "long",
            year: "numeric",
        })
            .formatToParts(new Date(value))
            .find((p) => p.type === field)?.value || ""
    );
}
function time(value: string) {
    return new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    }).format(new Date(value));
}
function range(booking: Booking) {
    const sameMonth =
        part(booking.starts_at, "month") === part(booking.ends_at, "month") &&
        part(booking.starts_at, "year") === part(booking.ends_at, "year");
    if (!sameMonth)
        return `${date(booking.starts_at)} – ${date(booking.ends_at)}`;
    const first = part(booking.starts_at, "day"),
        last = part(booking.ends_at, "day");
    return `${part(booking.starts_at, "month")} ${first}${first === last ? "" : `–${last}`}, ${part(booking.starts_at, "year")}`;
}
function duration(booking: Booking) {
    if (booking.type === "day_tour") return "Day Tour";
    const day = (value: string) =>
        new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(new Date(value));
    const nights = Math.max(
        0,
        Math.round(
            (Date.parse(`${day(booking.ends_at)}T00:00:00Z`) -
                Date.parse(`${day(booking.starts_at)}T00:00:00Z`)) /
            86400000,
        ),
    );
    return `${nights + 1} ${nights + 1 === 1 ? "day" : "days"} and ${nights} ${nights === 1 ? "night" : "nights"}`;
}
function guests(booking: Booking) {
    if (booking.adults == null || booking.children == null) return null;
    const count = Number(booking.adults) + Number(booking.children);
    return Number.isFinite(count) ? count : null;
}
function payment(booking: Booking) {
    if (!Array.isArray(booking.payments)) return "Details unavailable";
    const approved = booking.payments
        .filter((p) => p.status === "approved")
        .reduce((sum, p) => sum + Number(p.amount), 0);
    if (Number(booking.deposit) > 0 && approved >= Number(booking.deposit))
        return "Deposit Verified";
    if (booking.payments.some((p) => p.status === "submitted"))
        return "Awaiting Review";
    if (approved > 0) return "Partially Verified";
    const latest = [...booking.payments].sort(
        (a, b) => Number(b.id) - Number(a.id),
    )[0];
    if (latest?.status === "rejected") return "Receipt Rejected";
    if (latest?.status === "correction_requested") return "Correction Requested";
    return latest ? "Check Payment Details" : "Not Yet Paid";
}
function countdown(booking: Booking, now: number) {
    if (!booking.deadline) return "Awaiting staff instructions";
    const left = new Date(booking.deadline).getTime() - now;
    if (!Number.isFinite(left)) return "Deadline unavailable";
    if (left <= 0) return "Payment period ended";
    const minutes = Math.ceil(left / 60000);
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m remaining`;
}
function availability(booking: Booking, now: number) {
    if (booking.status === "confirmed") return "Reservation Confirmed";
    if (booking.status === "payment_review") return "Held for Verification";
    if (booking.status === "awaiting_deposit") {
        if (booking.opportunity === undefined) return "Details unavailable";
        return booking.opportunity?.status === "active" &&
            !!booking.deadline &&
            new Date(booking.deadline).getTime() > now
            ? "Opportunity Active"
            : "Awaiting Staff Update";
    }
    return booking.status === "queued"
        ? "Awaiting Opportunity"
        : "Pending Staff Review";
}
function message(booking: Booking, now: number) {
    if (booking.queue_notice) return booking.queue_notice;
    if (
        booking.status === "awaiting_deposit" &&
        payment(booking) === "Deposit Verified"
    )
        return "Your deposit is verified, but the reservation is awaiting a staff status update. Contact the resort before making another payment.";
    if (booking.status === "awaiting_deposit")
        return booking.deadline && new Date(booking.deadline).getTime() <= now
            ? "The deposit period has ended. Contact the resort for the next steps."
            : `Your reservation is awaiting the ${money(booking.deposit)} deposit. Submit your receipt before the saved deadline.`;
    if (booking.status === "payment_review")
        return "Your receipt has been submitted. Staff must verify the transfer before confirming your reservation.";
    if (booking.status === "confirmed")
        return "Your reservation is confirmed. Keep your booking reference ready for check-in.";
    if (booking.status === "queued")
        return "Your request is waiting for an opportunity. Staff will let you know when payment becomes available.";
    if (booking.status === "pending")
        return "Your request has been received and is awaiting staff review.";
    return `Reservation status: ${names[booking.status] || booking.status.replaceAll("_", " ")}.`;
}

export default function DashboardPage({
    user,
    onMakeReservation,
    onReservations,
    onSelect,
    onProfile,
    navigationError = "",
}: {
    user: User;
    onProfile?: () => void;
    navigationError?: string;
    onMakeReservation: () => void;
    onReservations: () => void;
    onSelect: (reservation: SavedReservation) => void;
}) {
    const [bookings, setBookings] = useState<Booking[] | null>(null);
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    const [clock, setClock] = useState(Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setClock(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        setBookings(null);
        setError("");
        async function load() {
            try {
                const response = await reservationApi<{ reservations: Booking[] }>(
                    "/reservations",
                    "GET",
                    undefined,
                    controller.signal,
                );
                if (!Array.isArray(response.reservations))
                    throw new Error("The reservation response is incomplete.");
                if (active) {
                    setBookings(
                        response.reservations.filter(
                            (booking) => Number(booking.user_id) === Number(user.id),
                        ),
                    );
                    setError("");
                }
            } catch (cause) {
                if (active && !controller.signal.aborted)
                    setError(
                        cause instanceof Error
                            ? cause.message
                            : "Unable to load your dashboard.",
                    );
            } finally {
                if (active) timer = setTimeout(() => void load(), 15000);
            }
        }
        void load();
        return () => {
            active = false;
            controller.abort();
            clearTimeout(timer);
        };
    }, [user.id, attempt]);

    const current = bookings
        ?.filter(
            (booking) =>
                !closed.includes(booking.status) &&
                new Date(booking.ends_at).getTime() > clock,
        )
        .sort(
            (a, b) =>
                new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime() ||
                Number(b.id) - Number(a.id),
        )[0];
    const updates = [...(bookings || [])]
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, 3);
    const queueNotice = [...(bookings || [])]
        .sort((a, b) => Number(b.id) - Number(a.id))
        .find((booking) => booking.queue_notice);
    const firstName = user.name.trim().split(/\s+/)[0] || user.name;
    const primary =
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#4c3425] bg-[#4c3425] px-5 py-3 text-xs font-bold text-white shadow-[0_8px_18px_rgba(76,52,37,0.16)] hover:bg-[#6e4b35]";
    const secondary =
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#e3d9cb] bg-[#fffdf8] px-4 py-2.5 text-xs font-semibold text-[#4c3425] hover:bg-[#f6f1e7]";
    const heading =
        "mb-2 block text-[9px] font-bold uppercase tracking-[0.17em] text-[#b08a52]";
    const card =
        "overflow-hidden rounded-xl border border-[#e3d9cb] bg-[#fffdf8]";
    const steps = [
        "Request Received",
        "Availability Review",
        "Deposit Review",
        "Confirmed",
    ];
    const stage = !current
        ? -1
        : current.status === "confirmed"
            ? 3
            : ["awaiting_deposit", "payment_review"].includes(current.status)
                ? 2
                : 1;

    return (
        <div className="min-h-screen bg-[#f6f1e7] font-sans text-[#2d261f] [&_button]:cursor-pointer [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-[#b08a52]">
            <GuestHeader
                user={user}
                activePage="dashboard"
                onDashboard={() => setAttempt((value) => value + 1)}
                onMakeReservation={onMakeReservation}
                onReservations={onReservations}
                onProfile={onProfile}
            />
            <main
                className="mx-auto max-w-[1280px] space-y-5 px-4 py-7 md:px-8"
                aria-busy={bookings === null && !error}
            >
                <section
                    className={`${card} px-6 py-8 shadow-[0_8px_24px_rgba(63,47,33,0.04)] md:px-8 md:py-10`}
                >
                    <span className={heading}>Your private escape awaits</span>
                    <h1 className="m-0 font-serif text-[40px] leading-tight tracking-[-0.045em] md:text-[48px]">
                        Welcome, {firstName}
                    </h1>
                    <p className="mt-3 mb-6 text-xs leading-relaxed text-[#776f65]">
                        Relax, plan your stay, and keep every reservation detail close at
                        hand.
                    </p>
                    <button className={primary} type="button" onClick={onMakeReservation}>
                        New Reservation Request <Icon name="arrow" size={15} />
                    </button>
                </section>
                {(error || navigationError) && (
                    <div
                        role="alert"
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e8c8c3] bg-[#f7e6e3] p-4 text-xs text-[#a44b45]"
                    >
                        <span>
                            {error || navigationError}
                            {bookings !== null ? " Showing the last loaded information." : ""}
                        </span>
                        <button
                            type="button"
                            className="border-0 bg-transparent font-semibold underline"
                            onClick={() => setAttempt((value) => value + 1)}
                        >
                            Try Again
                        </button>
                    </div>
                )}
                {queueNotice?.queue_notice && (
                    <div role='alert' className='rounded-lg border border-[#e8c8c3] bg-[#f7e6e3] p-5 text-xs text-[#a44b45]'>
                        <b>Reservation opportunity no longer available. </b>
                        {queueNotice.queue_notice}
                    </div>
                )}
                {bookings === null ? (
                    !error && (
                        <section
                            role="status"
                            className={`${card} p-8 text-center text-sm text-[#776f65]`}
                        >
                            Loading your reservation details…
                        </section>
                    )
                ) : current ? (
                    <>
                        <section className={card}>
                            <header className="flex flex-col items-start justify-between gap-4 border-b border-[#e3d9cb] p-6 sm:flex-row">
                                <div>
                                    <span className={heading}>Current reservation</span>
                                    <h2 className="m-0 font-serif text-2xl leading-tight">
                                        {range(current)}
                                    </h2>
                                    <p className="mt-2 mb-0 text-[11px] text-[#776f65]">
                                        {duration(current)}
                                        {guests(current) !== null
                                            ? ` · ${guests(current)} guests`
                                            : ""}
                                    </p>
                                </div>
                                <span
                                    className={`rounded-full px-3 py-1.5 text-[8px] font-semibold uppercase tracking-wide ${current.status === "confirmed" ? "bg-[#e8eee5] text-[#59754f]" : "bg-[#e6efed] text-[#527a76]"}`}
                                >
                                    {names[current.status] || current.status.replaceAll("_", " ")}
                                </span>
                            </header>
                            <div className="grid lg:grid-cols-[1.1fr_1fr]">
                                <div className="p-6">
                                    <span className={heading}>Current reservation status</span>
                                    <h3 className="m-0 text-xl font-normal text-[#805c27]">
                                        {names[current.status] ||
                                            current.status.replaceAll("_", " ")}
                                    </h3>
                                    <p className="mt-3 mb-5 max-w-lg text-xs leading-7 text-[#776f65]">
                                        {message(current, clock)}
                                    </p>
                                    {current.status === "awaiting_deposit" &&
                                        payment(current) !== "Deposit Verified" && (
                                            <div className="mb-5 inline-flex flex-col gap-1 rounded-lg bg-[#f6ecd7] px-4 py-3">
                                                <span className="text-[8px] uppercase tracking-wide text-[#805c27]">
                                                    Deposit deadline
                                                </span>
                                                <b className="text-xs font-semibold">
                                                    {countdown(current, clock)}
                                                </b>
                                            </div>
                                        )}
                                    <div>
                                        <button
                                            className={secondary}
                                            type="button"
                                            onClick={() => onSelect(current)}
                                        >
                                            View Reservation Details <Icon name="arrow" size={15} />
                                        </button>
                                    </div>
                                </div>
                                <div className="grid min-h-60 grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-[#e3d9cb] bg-[#f6f1e7] px-6 py-8 text-center lg:border-t-0 lg:border-l">
                                    {["starts_at", "ends_at"].map((key, index) => (
                                        <div
                                            key={key}
                                            className={
                                                index === 0 ? "col-start-1" : "col-start-3 row-start-1"
                                            }
                                        >
                                            <span className="block text-[8px] uppercase tracking-widest text-[#776f65]">
                                                {index === 0 ? "Check in" : "Check out"}
                                            </span>
                                            <strong className="my-2 block font-serif text-[48px] font-normal leading-none">
                                                {part(current[key as "starts_at" | "ends_at"], "day")}
                                            </strong>
                                            <b className="block text-[10px] font-medium">
                                                {part(current[key as "starts_at" | "ends_at"], "month")}{" "}
                                                {part(current[key as "starts_at" | "ends_at"], "year")}
                                            </b>
                                            <small className="mt-1 block text-[9px] text-[#b08a52]">
                                                {time(current[key as "starts_at" | "ends_at"])}
                                            </small>
                                        </div>
                                    ))}
                                    <span className="col-start-2 row-start-1 text-[#b08a52]">
                                        <Icon name="arrow" size={18} />
                                    </span>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 border-t border-[#e3d9cb] lg:grid-cols-4">
                                {[
                                    [
                                        "Your reservation status",
                                        names[current.status] || current.status,
                                    ],
                                    ["Reservation ID", current.reference],
                                    ["Payment status", payment(current)],
                                    [
                                        "Guests",
                                        guests(current) === null
                                            ? "Not provided"
                                            : String(guests(current)),
                                    ],
                                ].map(([label, value]) => (
                                    <div
                                        key={label}
                                        className="min-w-0 border-r border-b border-[#e3d9cb] px-5 py-4 last:border-r-0 lg:border-b-0"
                                    >
                                        <span className="mb-2 block text-[8px] text-[#776f65]">
                                            {label}
                                        </span>
                                        <b className="block text-xs font-semibold wrap-anywhere">
                                            {value}
                                        </b>
                                    </div>
                                ))}
                            </div>
                        </section>
                        <div className="grid gap-4 md:grid-cols-3">
                            {[
                                {
                                    title: "Availability",
                                    value: availability(current, clock),
                                    copy: "Track your reservation opportunity.",
                                    icon: "shield" as const,
                                },
                                {
                                    title: "Payment",
                                    value: payment(current),
                                    copy: "Follow your current payment details.",
                                    icon: "credit" as const,
                                },
                                {
                                    title: "Stay Overview",
                                    value: duration(current),
                                    copy: range(current),
                                    icon: "calendar" as const,
                                },
                            ].map((item) => (
                                <section key={item.title} className={`${card} p-5`}>
                                    <div className="flex items-start gap-3">
                                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#e8eee5] text-[#607466]">
                                            <Icon name={item.icon} size={18} />
                                        </span>
                                        <div className="min-w-0">
                                            <span className="block text-[8px] uppercase tracking-widest text-[#776f65]">
                                                {item.title}
                                            </span>
                                            <b className="mt-1 block text-xs font-semibold text-[#4c3425]">
                                                {item.value}
                                            </b>
                                            <p className="mt-1 mb-0 text-[9px] leading-relaxed text-[#776f65]">
                                                {item.copy}
                                            </p>
                                        </div>
                                    </div>
                                </section>
                            ))}
                        </div>
                    </>
                ) : (
                    <section className={`${card} p-8 text-center`}>
                        <h2 className="mb-3 font-serif text-2xl">
                            Your next stay starts here
                        </h2>
                        <p className="mb-6 text-sm text-[#776f65]">
                            You have no upcoming or ongoing reservation requests.
                        </p>
                        <button
                            className={primary}
                            type="button"
                            onClick={onMakeReservation}
                        >
                            Plan Your Stay <Icon name="arrow" size={15} />
                        </button>
                    </section>
                )}
                {bookings !== null && (
                    <section className={`${card} p-6`}>
                        <div className="mb-4 flex items-center justify-between gap-4">
                            <div>
                                <span className={heading}>Personal updates</span>
                                <h2 className="m-0 text-lg font-normal text-[#4c3425]">
                                    Your reservation updates
                                </h2>
                            </div>
                            <button
                                type="button"
                                className="shrink-0 border-0 bg-transparent text-[10px] font-semibold text-[#4c3425] underline"
                                onClick={onReservations}
                            >
                                View all
                            </button>
                        </div>
                        {updates.length ? (
                            <ul className="m-0 list-none border-t border-[#e3d9cb] p-0">
                                {updates.map((booking) => (
                                    <li
                                        key={booking.id}
                                        className="border-b border-[#e3d9cb] last:border-0"
                                    >
                                        <button
                                            className="flex w-full items-start gap-3 border-0 bg-transparent px-0 py-4 text-left"
                                            type="button"
                                            onClick={() => onSelect(booking)}
                                        >
                                            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#b08a52]" />
                                            <span>
                                                <b className="block text-[11px] font-semibold">
                                                    {names[booking.status] ||
                                                        booking.status.replaceAll("_", " ")}
                                                </b>
                                                <span className="mt-1 block text-[9px] leading-relaxed text-[#776f65]">
                                                    {booking.reference} · {range(booking)}
                                                </span>
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="m-0 text-xs text-[#776f65]">
                                Your reservation updates will appear here after you submit a
                                request.
                            </p>
                        )}
                    </section>
                )}
                <section className={`${card} grid gap-6 p-6 lg:grid-cols-[220px_1fr]`}>
                    <div>
                        <span className={heading}>How it works</span>
                        <h2 className="m-0 text-lg font-normal text-[#4c3425]">
                            Your reservation journey
                        </h2>
                        <p className="mt-2 mb-0 text-[11px] leading-relaxed text-[#776f65]">
                            Follow each step from request to your confirmed private villa
                            stay.
                        </p>
                    </div>
                    <ol className="relative m-0 grid list-none grid-cols-2 gap-5 p-0 sm:grid-cols-4">
                        {steps.map((step, index) => {
                            const done = stage > index || (stage === 3 && index === 3);
                            const active = stage === index && stage !== 3;
                            return (
                                <li
                                    key={step}
                                    aria-current={active ? "step" : undefined}
                                    className="relative z-0"
                                >
                                    <div
                                        aria-hidden="true"
                                        className={`relative z-10 mb-3 grid size-7 place-items-center rounded-full text-[10px] font-semibold ${done ? "bg-[#607466] text-white" : active ? "bg-[#b08a52] text-white ring-4 ring-[#f6ecd7]" : "bg-[#eeeae4] text-[#776f65]"}`}
                                    >
                                        {done ? "✓" : index + 1}
                                    </div>
                                    {index < steps.length - 1 && (
                                        <span
                                            aria-hidden="true"
                                            className="absolute top-3.5 left-7 -right-5 hidden h-px bg-[#e3d9cb] sm:block"
                                        />
                                    )}
                                    <b className="block text-[9px] font-semibold text-[#4c3425]">
                                        {step}
                                    </b>
                                    <small className="mt-1 block text-[8px] leading-relaxed text-[#776f65]">
                                        {index === 0
                                            ? "Reservation saved"
                                            : index === 1
                                                ? "Opportunity reviewed"
                                                : index === 2
                                                    ? current?.status === "payment_review"
                                                        ? "Receipt awaiting review"
                                                        : "Deposit and verification"
                                                    : "Private villa reserved"}
                                    </small>
                                </li>
                            );
                        })}
                    </ol>
                </section>
            </main>
        </div>
    );
}
