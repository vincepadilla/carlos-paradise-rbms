import { apiBaseUrl, reservationApi, ReservationApiError } from "./ReservationApi";
import type { Paginated } from "../types/admin";
import type { AdminInput, AuditResponse, BackupValidation, DocumentHistory, OwnerAdmin, OwnerSettings, PaymentAccount } from "../types/owner";

export const OwnerApi = {
    settings: (signal: AbortSignal) => reservationApi<OwnerSettings>("/owner/settings", "GET", undefined, signal),
    saveSettings: (values: Record<string, string | number>) => reservationApi<OwnerSettings>("/owner/settings", "PATCH", values),
    admins: (query: URLSearchParams, signal: AbortSignal) => reservationApi<Paginated<OwnerAdmin>>(`/owner/admins?${query}`, "GET", undefined, signal),
    createAdmin: (data: AdminInput) => reservationApi<{ admin: OwnerAdmin }>("/owner/admins", "POST", data),
    updateAdmin: (id: number, data: AdminInput) => reservationApi<{ admin: OwnerAdmin }>(`/owner/admins/${id}`, "PATCH", data),
    documents: (key: string, signal: AbortSignal) => reservationApi<DocumentHistory>(`/owner/documents?${new URLSearchParams({ key })}`, "GET", undefined, signal),
    uploadDocument: (data: FormData) => reservationApi<DocumentHistory>("/owner/documents", "POST", data),
    documentUrl: (id: number, preview = false) => `${apiBaseUrl}/api/owner/documents/${id}/download${preview ? "?preview=1" : ""}`,
    audit: (query: URLSearchParams, signal: AbortSignal) => reservationApi<AuditResponse>(`/owner/audit-trail?${query}`, "GET", undefined, signal),
    paymentMethods: (signal: AbortSignal) => reservationApi<{ payment_methods: PaymentAccount[] }>("/owner/payment-methods", "GET", undefined, signal),
    savePaymentMethod: (data: Partial<PaymentAccount>) => reservationApi<{ payment_methods: PaymentAccount[] }>("/owner/payment-methods", "POST", data),
    validateBackup: (data: FormData) => reservationApi<BackupValidation>("/owner/database/validate", "POST", data),
    downloadBackup: async () => {
        const response = await fetch(`${apiBaseUrl}/api/owner/database/backup`, { credentials: "include", cache: "no-store", headers: { Accept: "application/json" } });
        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new ReservationApiError(data?.message ?? "Unable to download the backup.", response.status);
        }
        const filename = response.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/)?.[1] ?? "carlos-paradise-backup.json";
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url; link.download = filename; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
};
