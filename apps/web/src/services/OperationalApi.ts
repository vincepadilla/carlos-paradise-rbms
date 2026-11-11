import { apiBaseUrl, reservationApi } from "./ReservationApi";

// Portal selection only chooses a route namespace. Laravel independently authorizes every request.
export function operationalPath(path: string, pathname = window.location.pathname): string {
    return pathname === "/owner" || pathname.startsWith("/owner/")
        ? path.replace(/^\/admin(?=\/|\?|$)/, "/owner/operations") : path;
}

export function operationalApiUrl(path: string): string {
    return `${apiBaseUrl}/api${operationalPath(path)}`;
}

export const operationalApi: typeof reservationApi = (path, ...args) => reservationApi(operationalPath(path), ...args);
