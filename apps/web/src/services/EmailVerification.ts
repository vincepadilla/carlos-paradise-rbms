import { apiBaseUrl } from "./ReservationApi";

export type PendingVerification = {
    masked_email: string;
    expires_at: string;
    resend_available_at: string;
    delivery_status: "queued" | "sent" | "failed";
};

export function readVerification(value: unknown): PendingVerification | null {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (typeof item.masked_email !== "string" ||
        typeof item.expires_at !== "string" ||
        typeof item.resend_available_at !== "string" ||
        !["queued", "sent", "failed"].includes(String(item.delivery_status))) return null;
    return item as PendingVerification;
}

async function csrfToken(): Promise<string> {
    const response = await fetch(`${apiBaseUrl}/sanctum/csrf-cookie`, {
        headers: { Accept: "application/json" },
        credentials: "include",
    });
    if (!response.ok) throw new Error("Could not initialize the request.");
    const cookie = document.cookie.split("; ").find((item) => item.startsWith("XSRF-TOKEN="));
    if (!cookie) throw new Error("The security cookie is unavailable.");
    return decodeURIComponent(cookie.substring("XSRF-TOKEN=".length));
}

export async function verificationRequest(
    action: "status" | "verify" | "resend",
    body: { code?: string } = {},
): Promise<{ response: Response; data: Record<string, unknown> | null }> {
    const xsrf = await csrfToken();
    const response = await fetch(`${apiBaseUrl}/api/email-verification/${action}`, {
        method: "POST",
        credentials: "include",
        headers: {
            "X-XSRF-TOKEN": xsrf,
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => null);
    return {
        response,
        data: payload && typeof payload === "object"
            ? payload as Record<string, unknown>
            : null,
    };
}