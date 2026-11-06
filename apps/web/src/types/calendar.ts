import type { AdminReservation, AvailabilityBlock } from "./admin";

export type CalendarView = "Month" | "Week" | "Day";
export type CalendarCategory = "secured" | "completed" | "opportunity" | "queue" | "ocular" | "blocked";
export type CalendarData = { reservations: AdminReservation[]; blocks: AvailabilityBlock[] };
type EventDetails = {
    id: string; category: CalendarCategory; label: string; title: string;
    startsOn: string; endsOn: string; timeLabel: string;
};
export type CalendarEvent = EventDetails & (
    | { kind: "reservation"; reservation: AdminReservation }
    | { kind: "block"; block: AvailabilityBlock }
);
