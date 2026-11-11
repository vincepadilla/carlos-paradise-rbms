export type SettingField = { key: string; label: string; type?: "number" | "time" | "textarea"; min?: number; max?: number; step?: number; help?: string };
export const settingsSections = ["Resort Information", "Reservation Settings", "Guest Capacity", "Payment Settings", "Amenities & Inclusions", "Landing Page Content", "Pricing", "Policies", "Notifications", "Document Management"] as const;
export type SettingsSection = typeof settingsSections[number];

export const settingsFields: Partial<Record<SettingsSection, SettingField[]>> = {
    "Resort Information": [{ key: "name", label: "Resort Name" }, { key: "contact", label: "Contact Information" }, { key: "address", label: "Address", type: "textarea" }, { key: "description", label: "Resort Description", type: "textarea" }],
    "Reservation Settings": [
        { key: "deposit", label: "Reservation Deposit (PHP)", type: "number", min: 0, step: .01 },
        { key: "opportunity_hours", label: "Opportunity Duration (hours)", type: "number", min: 1, max: 720, step: 1 },
        { key: "min_lead_days", label: "Minimum Advance Booking (days)", type: "number", min: 0, max: 365, step: 1 },
        { key: "check_in_time", label: "Check-in Time", type: "time" }, { key: "check_out_time", label: "Check-out Time", type: "time" },
        { key: "reservation_instructions", label: "Reservation Instructions", type: "textarea" },
        { key: "payment_deadline_instructions", label: "Payment Deadline Instructions", type: "textarea" },
    ],
    "Guest Capacity": [
        { key: "standard_guests", label: "Included Guests", type: "number", min: 1, max: 10000, step: 1 },
        { key: "max_guests", label: "Maximum Guest Capacity", type: "number", min: 1, max: 10000, step: 1 },
        { key: "extra_guest_fee", label: "Additional Guest Fee (PHP)", type: "number", min: 0, step: .01 },
    ],
    "Payment Settings": [{ key: "payment_instructions", label: "Payment Instructions", type: "textarea" }, { key: "security_deposit", label: "Security Deposit (PHP)", type: "number", min: 0, step: .01 }],
    "Amenities & Inclusions": [{ key: "amenities", label: "Amenities", type: "textarea", help: "Enter one amenity per line." }, { key: "inclusions", label: "Inclusions", type: "textarea", help: "Enter one inclusion per line." }],
    "Landing Page Content": [{ key: "landing_title", label: "Hero Title" }, { key: "landing_description", label: "Hero Description", type: "textarea" }],
    "Pricing": [
        { key: "weekday_rate", label: "Weekday Rate (PHP)" }, { key: "friday_saturday_rate", label: "Friday & Saturday Rate (PHP)" },
        { key: "sunday_rate", label: "Sunday Rate (PHP)" }, { key: "special_rate", label: "Special Date Rate (PHP)" },
        { key: "day_tour_rate", label: "Day Tour Reference Rate (PHP)", help: "Day tours still require a staff-agreed final price." },
        { key: "holiday_surcharge", label: "Holiday Surcharge (PHP)" }, { key: "cleaning_fee", label: "Cleaning Fee (PHP)" },
        { key: "bonfire_price", label: "Bonfire Price (PHP)" }, { key: "charcoal_price", label: "Charcoal Price (PHP)" }, { key: "liquor_price", label: "Liquor Fee (PHP)" },
    ].map(field => ({ ...field, type: "number" as const, min: 0, step: .01 })),
    "Policies": [{ key: "policies", label: "Resort Policies", type: "textarea" }],
};
