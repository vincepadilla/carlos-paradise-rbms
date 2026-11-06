import { apiBaseUrl, ReservationApiError } from "./ReservationApi";
import { readAuthenticatedUser, type AuthenticatedUser } from "../types/auth";

export async function fetchAuthenticatedUser(signal?: AbortSignal): Promise<AuthenticatedUser | null> {
    const response = await fetch(`${apiBaseUrl}/auth/user`, {
        headers: { Accept: "application/json" },
        credentials: "include",
        cache: "no-store",
        signal,
    });
    if (response.status === 401) return null;
    if (!response.ok) {
        throw new ReservationApiError(`Unable to check your session (${response.status}).`, response.status);
    }
    const user = readAuthenticatedUser(await response.json());
    if (!user) throw new Error("The server returned an unexpected account response.");
    return user;
}
