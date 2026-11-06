import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAuthenticatedUser } from "../services/AuthSession";
import { ReservationApiError } from "../services/ReservationApi";
import type { AuthenticatedUser } from "../types/auth";

type SessionState =
    | { status: "loading" }
    | { status: "authenticated"; user: AuthenticatedUser; isRevalidating: boolean }
    | { status: "anonymous" }
    | { status: "error"; message: string };

export function useAuthenticatedSession() {
    const [session, setSession] = useState<SessionState>({ status: "loading" });
    const inFlight = useRef<AbortController | null>(null);

    const revalidate = useCallback(() => {
        if (inFlight.current) return;
        const controller = new AbortController();
        inFlight.current = controller;
        // The protected parent owns this session across all of its child routes.
        setSession(current => current.status === "authenticated"
            ? { ...current, isRevalidating: true }
            : { status: "loading" });
        void fetchAuthenticatedUser(controller.signal).then(user => {
            if (!controller.signal.aborted) {
                setSession(user
                    ? { status: "authenticated", user, isRevalidating: false }
                    : { status: "anonymous" });
            }
        }).catch((cause: unknown) => {
            if (!controller.signal.aborted) {
                const rejected = cause instanceof ReservationApiError && [401, 403, 419].includes(cause.status);
                setSession(rejected ? { status: "anonymous" }
                    : { status: "error", message: cause instanceof Error ? cause.message : "Unable to check your session." });
            }
        }).finally(() => {
            if (inFlight.current === controller) inFlight.current = null;
        });
    }, []);

    const clear = useCallback(() => {
        // A response already in progress must never restore a logged-out user.
        inFlight.current?.abort();
        inFlight.current = null;
        setSession({ status: "anonymous" });
    }, []);

    useEffect(() => {
        revalidate();
        return () => {
            inFlight.current?.abort();
            inFlight.current = null;
        };
    }, [revalidate]);

    useEffect(() => {
        let foregroundTimer: ReturnType<typeof setTimeout> | undefined;
        function onForeground() {
            if (document.visibilityState !== "visible" || inFlight.current) return;
            // Returning to a tab commonly emits both visibilitychange and focus.
            clearTimeout(foregroundTimer);
            foregroundTimer = setTimeout(revalidate, 100);
        }
        function onPageShow(event: PageTransitionEvent) {
            if (event.persisted) onForeground();
        }
        window.addEventListener("focus", onForeground);
        window.addEventListener("pageshow", onPageShow);
        document.addEventListener("visibilitychange", onForeground);
        return () => {
            clearTimeout(foregroundTimer);
            window.removeEventListener("focus", onForeground);
            window.removeEventListener("pageshow", onPageShow);
            document.removeEventListener("visibilitychange", onForeground);
        };
    }, [revalidate]);

    return { session, isRevalidating: session.status === "authenticated" && session.isRevalidating, revalidate, clear };
}
