export const apiBaseUrl = (
    import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");
export class ReservationApiError extends Error {
    status: number;
    constructor(
        message: string,
        status: number,
    ) {
        super(message);
        this.status = status;
    }
}

async function readJson<T>(response: Response): Promise<T> {
    const data = await response.json().catch(() => null);
    if (!response.ok) {
        throw new ReservationApiError(
            response.status === 404
                ? "This backend endpoint is not implemented yet. Check the Laravel reservation and payment routes."
                : data?.errors
                    ? Object.values(data.errors as Record<string, string[]>)
                        .flat()
                        .join(" ")
                    : data?.message || `Request failed (${response.status}).`,
            response.status,
        );
    }
    if (!data)
        throw new ReservationApiError(
            "The server did not return JSON. Check the API URL and Laravel routes.",
            response.status,
        );
    return data as T;
}
let csrf = "";
let csrfRequest: Promise<void> | null = null;
async function loadCsrf(signal?: AbortSignal): Promise<void> {
    if (!csrfRequest)
        csrfRequest = (async () => {
            const data = await readJson<{ token: string }>(
                await fetch(`${apiBaseUrl}/api/csrf`, {
                    credentials: "include",
                    headers: { Accept: "application/json" },
                    cache: "no-store",
                    signal,
                }),
            );
            if (!data.token)
                throw new Error("The CSRF response is missing its token.");
            csrf = data.token;
        })().finally(() => {
            csrfRequest = null;
        });
    await csrfRequest;
}
export function resetReservationCsrf(): void {
    csrf = "";
}
export async function reservationApi<T>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
    retryCsrf = true,
): Promise<T> {
    if (method !== "GET" && !csrf) await loadCsrf();
    const multipart = body instanceof FormData;
    const response = await fetch(`${apiBaseUrl}/api${path}`, {
        method,
        credentials: "include",
        cache: "no-store",
        signal,
        headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
            ...(method === "GET" ? {} : { "X-CSRF-TOKEN": csrf }),
            ...(!body || multipart ? {} : { "Content-Type": "application/json" }),
        },
        body: body
            ? multipart
                ? (body as FormData)
                : JSON.stringify(body)
            : undefined,
    });
    // Only a CSRF rejection is retried. A failed network response could already have saved a request.
    if (response.status === 419 && retryCsrf) {
        csrf = "";
        await loadCsrf();
        return reservationApi<T>(path, method, body, signal, false);
    }
    return readJson<T>(response);
}
