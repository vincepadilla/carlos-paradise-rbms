import type { AdminReservation } from "../types/admin";
import { pendingDeposits } from "./paymentReview.ts";
import type { Payment } from "../types/reservation";

const timeZone = "Asia/Manila";
export const dashboardDate = (value: string) => new Intl.DateTimeFormat("en-US", {
    timeZone, month: "long", day: "numeric", year: "numeric",
}).format(new Date(value));
export const dashboardTime = (value: string) => new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "numeric", minute: "2-digit", hour12: true,
}).format(new Date(value));

export function initials(name: string): string {
    return name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] ?? "").join("").toUpperCase() || "A";
}

export function guestCount(reservation: AdminReservation): string {
    const count = Number(reservation.adults) + Number(reservation.children);
    return Number.isFinite(count) ? `${count} ${count === 1 ? "guest" : "guests"}` : "Not provided";
}

function manilaDay(value: string): number {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" })
        .formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value);
    return Date.UTC(part("year"), part("month") - 1, part("day"));
}

export function stayDuration(reservation: AdminReservation): string {
    if (reservation.type === "day_tour") return "Day tour";
    const nights = Math.max(0, Math.round((manilaDay(reservation.ends_at) - manilaDay(reservation.starts_at)) / 86_400_000));
    return `${nights + 1} ${nights === 0 ? "day" : "days"} and ${nights} ${nights === 1 ? "night" : "nights"}`;
}

export function depositState(reservation: AdminReservation): { label: string; amount?: number } {
    if (!Array.isArray(reservation.payments)) return { label: "Unavailable" };
    const approved = reservation.payments.filter(payment => payment.status === "approved").reduce((total, payment) => {
        const amount = Number(payment.amount);
        return total + (Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0);
    }, 0);
    const required = Math.round(Number(reservation.deposit) * 100);
    if (approved > 0) return { label: approved >= required ? "Verified" : "Partially verified", amount: approved / 100 };
    if (reservation.payments.some(payment => payment.status === "submitted")) return { label: "Awaiting review" };
    if (reservation.payments.some(payment => payment.status === "rejected")) return { label: "Rejected" };
    return { label: required === 0 ? "No deposit required" : "Not yet paid" };
}

export type PendingDeposit = { reservation: AdminReservation; payment: Payment };
export type VillaMovement = { reservation: AdminReservation; at: string; kind: "Check-in" | "Check-out" };

export function selectDashboard(reservations: AdminReservation[], now: number) {
    const scheduled = reservations.filter(reservation =>
        Number.isFinite(Date.parse(reservation.starts_at)) &&
        Number.isFinite(Date.parse(reservation.ends_at)) &&
        Date.parse(reservation.ends_at) > Date.parse(reservation.starts_at));
    const confirmed = scheduled.filter(reservation => reservation.status === "confirmed");
    const ongoing = confirmed.filter(reservation => Date.parse(reservation.starts_at) <= now && Date.parse(reservation.ends_at) > now)
        .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at) || left.id - right.id)[0] ?? null;
    const queue = scheduled.filter(reservation => ["pending", "queued", "awaiting_deposit"].includes(reservation.status))
        .sort((left, right) => (left.queue_position ?? Infinity) - (right.queue_position ?? Infinity) || left.id - right.id);
    const deposits: PendingDeposit[] = pendingDeposits(reservations);
    const movements: VillaMovement[] = confirmed.flatMap(reservation => {
        const items: VillaMovement[] = [];
        if (Date.parse(reservation.starts_at) > now) items.push({ reservation, at: reservation.starts_at, kind: "Check-in" });
        if (Date.parse(reservation.ends_at) > now) items.push({ reservation, at: reservation.ends_at, kind: "Check-out" });
        return items;
    }).sort((left, right) => Date.parse(left.at) - Date.parse(right.at) ||
        (left.kind === right.kind ? left.reservation.id - right.reservation.id : left.kind === "Check-out" ? -1 : 1));
    return { ongoing, queue, deposits, movement: movements[0] ?? null,
        paymentsAvailable: reservations.every(reservation => Array.isArray(reservation.payments)) };
}
