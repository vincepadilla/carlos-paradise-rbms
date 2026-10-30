export const money = (value: number | string | null) =>
    value === null
        ? "Pending agreement"
        : new Intl.NumberFormat("en-PH", {
            style: "currency",
            currency: "PHP",
        }).format(Number(value));
export const dateTime = (value: string) =>
    new Date(value).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
    });
export const manilaToday = () =>
    new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());

export const statuses: Record<string, string> = {
    pending: "Pending staff review",
    queued: "Waiting for an opportunity",
    awaiting_deposit: "Deposit opportunity active",
    payment_review: "Receipt under review",
    confirmed: "Reservation confirmed",
    expired: "Deposit opportunity expired",
    cancelled: "Reservation cancelled",
    rejected: "Dates secured by an earlier request",
    completed: "Stay completed",
    held: "Held for review",
    reserved: "Reserved",
};
