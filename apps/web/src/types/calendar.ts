import type { AdminReservation, AvailabilityBlock } from "./admin";

export type CalendarView = "Month" | "Week" | "Day";
export type CalendarCategory = "secured" | "completed" | "opportunity" | "queue" | "ocular" | "blocked";
export type OcularVisitStatus = 'pending_review' | 'approved' | 'cancelled';
export type OcularVisit = {
    id: number; guest_name: string; contact_details: string; visit_date: string;
    start_time: string; end_time: string; status: OcularVisitStatus;
    inquiry_source: string | null; notes: string | null; created_by: number; creator_name: string;
    revision: number; updated_at: string;
};
export type OcularVisitInput = Pick<OcularVisit, 'guest_name' | 'contact_details' | 'visit_date' | 'start_time' | 'end_time' | 'status'> & { inquiry_source: string; notes: string };
export type OcularVisitUpdate = Omit<OcularVisitInput, 'status'> & { revision: number };
export type CalendarData = { reservations: AdminReservation[]; blocks: AvailabilityBlock[]; ocular_visits: OcularVisit[] };
type EventDetails = {
    id: string; category: CalendarCategory; label: string; title: string;
    startsOn: string; endsOn: string; timeLabel: string;
};
export type CalendarEvent = EventDetails & (
    | { kind: "reservation"; reservation: AdminReservation }
    | { kind: "block"; block: AvailabilityBlock }
    | { kind: 'ocular'; ocularVisit: OcularVisit }
);
