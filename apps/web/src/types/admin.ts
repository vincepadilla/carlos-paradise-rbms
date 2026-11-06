import type { SavedReservation } from "./reservation";

export type AdminReservation = SavedReservation & {
    user_id: number;
    adults: number;
    children: number;
    pets: number;
    notes: string | null;
    opportunity: { id: number; status: string } | null;
    extension_status: string | null;
    extension_reason: string | null;
    extension_message: string | null;
    extension_date: string | null;
    completed_at?: string | null;
    extension_access?: { enabled: boolean | number; agreed_deadline: string; granted_at: string; revoked_at: string | null; consumed_at: string | null } | null;
};

export type AdminGuest = {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    is_active: boolean;
    email_verified_at: string | null;
};

export type AvailabilityBlock = {
    id: number;
    starts_on: string;
    ends_on: string;
    reason: string;
};

export type Paginated<T> = {
    data: T[];
    current_page: number;
    last_page: number;
    total: number;
};
