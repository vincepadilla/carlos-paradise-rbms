import { useCallback, useEffect, useState } from "react";
import { useAdminSession } from "../components/auth/RequireAdmin";
import { AdminApi } from "../services/AdminApi";
import { ReservationApiError } from "../services/ReservationApi";
import type { CalendarData } from "../types/calendar";

type State = { key: string } & ({ status: "loading" } | { status: "ready"; data: CalendarData } | { status: "error"; message: string });
export function useCalendarData(start: string, end: string) {
    const [revision, setRevision] = useState(0);
    const key = `${start}:${end}:${revision}`;
    const [state, setState] = useState<State>({ key, status: "loading" });
    const { clear, revalidate } = useAdminSession();
    const reload = useCallback(() => setRevision(value => value + 1), []);
    useEffect(() => {
        const controller = new AbortController();
        setState({ key, status: "loading" });
        void AdminApi.calendar(start, end, controller.signal).then(data => {
            if (!controller.signal.aborted) setState({ key, status: "ready", data });
        }).catch((cause: unknown) => {
            if (controller.signal.aborted) return;
            if (cause instanceof ReservationApiError && cause.status === 401) clear();
            if (cause instanceof ReservationApiError && cause.status === 403) revalidate();
            setState({ key, status: "error", message: cause instanceof Error ? cause.message : "Unable to load the calendar." });
        });
        return () => controller.abort();
    }, [key, start, end, clear, revalidate]);
    return { state: state.key === key ? state : { key, status: "loading" as const }, reload };
}
