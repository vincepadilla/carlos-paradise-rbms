import { useEffect, useState, type ReactNode } from "react";
import { ReservationApiError } from "../../services/ReservationApi";
import { useAdminSession } from "../auth/RequireAdmin";

type ResourceState<T> =
    | { status: "loading" }
    | { status: "success"; data: T }
    | { status: "error"; message: string };

export default function AdminResource<T>({ load, children, showRefresh = true }: {
    load: (signal: AbortSignal) => Promise<T>;
    children: (data: T) => ReactNode;
    showRefresh?: boolean;
}) {
    const [state, setState] = useState<ResourceState<T>>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);
    const { revalidate } = useAdminSession();

    useEffect(() => {
        const controller = new AbortController();
        setState({ status: "loading" });
        void load(controller.signal).then(data => {
            if (!controller.signal.aborted) setState({ status: "success", data });
        }).catch((cause: unknown) => {
            if (controller.signal.aborted) return;
            if (cause instanceof ReservationApiError && (cause.status === 401 || cause.status === 403)) {
                revalidate();
                return;
            }
            setState({ status: "error", message: cause instanceof Error ? cause.message : "Unable to load this information." });
        });
        return () => controller.abort();
    }, [load, attempt, revalidate]);

    if (state.status === "loading") return <p role="status">Loading…</p>;
    if (state.status === "error") return <div role="alert">
        <p>{state.message}</p>
        <button type="button" className="admin-button" onClick={() => setAttempt(value => value + 1)}>Try again</button>
    </div>;
    return <>
        {showRefresh && <button type="button" className="admin-button mb-4" onClick={() => setAttempt(value => value + 1)}>Refresh data</button>}
        {children(state.data)}
    </>;
}
