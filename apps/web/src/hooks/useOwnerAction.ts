import { useRef, useState } from "react";
import { useAdminSession } from "../components/auth/RequireAdmin";
import { ReservationApiError } from "../services/ReservationApi";

export function useOwnerAction() {
    const { revalidate } = useAdminSession();
    const inFlight = useRef(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    async function run(action: () => Promise<void>, success = "") {
        if (inFlight.current) return;
        inFlight.current = true; setBusy(true); setError(""); setNotice("");
        try {
            await action(); setNotice(success);
        } catch (cause) {
            if (cause instanceof ReservationApiError && [401, 403, 419].includes(cause.status)) revalidate();
            setError(cause instanceof Error ? cause.message : "Unable to complete this action.");
        } finally { inFlight.current = false; setBusy(false); }
    }
    return { busy, error, notice, run };
}
