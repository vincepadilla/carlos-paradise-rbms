import type { Paginated } from "./admin";

export type OwnerAdmin = { id: number; name: string; email: string; is_active: boolean; created_at: string; updated_at: string };
export type AdminInput = { name?: string; email?: string; password?: string; is_active?: boolean };
export type DocumentVersion = { id: number; version: number; original_name: string; size: number; notes: string | null; sha256: string; created_at: string; uploaded_by: string };
export type DocumentHistory = { active_version_id: number | null; versions: DocumentVersion[] };
export type AuditEntry = { id: number; source: string; occurred_at: string; user_name: string; role: string; action: string; module: string; details: string };
export type AuditResponse = Paginated<AuditEntry> & { filters: { modules: string[]; actions: string[] }; integrity: string };
export type OwnerSettings = { settings: Record<string, unknown> };
export type PaymentAccount = { id: number; name: string; account_name: string; account_number: string; instructions: string | null; is_active: boolean | number };
export type BackupValidation = { tables: Record<string, number>; restore_supported: false; message: string };
