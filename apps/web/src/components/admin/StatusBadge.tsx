import type { ReactNode } from "react";

type Tone = "amber" | "green" | "aqua" | "red" | "neutral";
const statuses: Record<string, { label: string; tone: Tone }> = {
    ongoing: { label: "Ongoing Stay", tone: "green" },
    confirmed: { label: "Confirmed", tone: "green" },
    awaiting_deposit: { label: "Awaiting Deposit", tone: "amber" },
    queued: { label: "Awaiting Reservation Opportunity", tone: "aqua" },
    pending: { label: "Pending Review", tone: "amber" },
    payment_review: { label: "Payment Review", tone: "amber" },
    cancelled: { label: "Cancelled", tone: "red" },
    rejected: { label: "Rejected", tone: "red" },
    expired: { label: "Expired", tone: "neutral" },
    completed: { label: "Completed", tone: "neutral" },
};

export default function StatusBadge({ status, children }: { status: string; children?: ReactNode }) {
    const { label, tone } = statuses[status] ?? { label: status, tone: "neutral" };
    return <span className={`badge badge-${tone}`}>{children ?? label}</span>;
}
