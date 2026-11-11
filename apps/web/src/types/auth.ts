export type KnownRole = "guest" | "admin" | "owner";

export type AuthenticatedUser = {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    avatar: string | null;
    role: string | null;
    email_verified: boolean;
};

export function readAuthenticatedUser(payload: unknown): AuthenticatedUser | null {
    if (!payload || typeof payload !== "object" || !("user" in payload)) return null;
    const user = payload.user;
    if (!user || typeof user !== "object") return null;
    if (!("id" in user) || !Number.isSafeInteger(user.id) || Number(user.id) <= 0 ||
        !("name" in user) || typeof user.name !== "string" ||
        !("email" in user) || typeof user.email !== "string" ||
        !("phone" in user) || (user.phone !== null && typeof user.phone !== "string") ||
        !("avatar" in user) || (user.avatar !== null && typeof user.avatar !== "string") ||
        !("role" in user) || (user.role !== null && typeof user.role !== "string") ||
        !("email_verified" in user) || typeof user.email_verified !== "boolean") return null;
    return user as AuthenticatedUser;
}

export function isAdmin(user: Pick<AuthenticatedUser, "role">): boolean {
    return user.role === "admin";
}

export function loginDestination(user: Pick<AuthenticatedUser, "role">): string {
    if (user.role === "owner") return "/owner/dashboard";
    return isAdmin(user) ? "/admin/dashboard" : "/";
}
