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
    address: string | null;
    latest_booking_reference: string | null;
    is_active: boolean;
    email_verified_at: string | null;
    created_at: string;
    updated_at: string;
};

export type AdminGuestUpdate = {
    name: string;
    email: string;
    phone: string | null;
    address: string | null;
    is_active: boolean;
};

export type AdminGuestReservation = {
    id: number;
    booking_reference: string;
    status: string;
    contact_address: string | null;
    requested_at: string;
    starts_at: string;
    ends_at: string;
    adults: number;
    children: number;
    required_deposit: string;
    payment_status: string;
    payment_amount: string;
    payment_amount_kind: "verified" | "submitted" | "rejected" | null;
};

export type AdminGuestDetails = {
    guest: AdminGuest;
    reservation: AdminGuestReservation | null;
    reservations: AdminGuestReservation[];
    payments: Array<{
        id: number;
        reservation_id: number;
        booking_reference: string;
        amount: string;
        status: string;
        payment_kind: string;
        reference: string;
        payment_date: string | null;
        submitted_at: string;
        method: string;
    }>;
    activity: Array<{
        id: string;
        kind: 'account' | 'reservation';
        event: string;
        from_status: string | null;
        to_status: string | null;
        reason: string | null;
        occurred_at: string;
        reservation_id: number | null;
        booking_reference: string | null;
        actor_name: string | null;
    }>;
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
