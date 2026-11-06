import { useCallback } from "react";
import { useBeforeUnload, useBlocker } from "react-router";
import { DetailConfirmation } from "./DetailPrimitives";

export default function UnsavedReservationGuard({ dirty, busy }: { dirty: boolean; busy: boolean }) {
    useBeforeUnload(useCallback(event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } }, [dirty, busy]));
    const blocker = useBlocker(({ currentLocation, nextLocation }) => (dirty || busy) && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
    if (blocker.state !== "blocked") return null;
    return <DetailConfirmation title="Unsaved Reservation Changes" busy={busy} onClose={() => blocker.reset()}>
        <p>{busy ? "Your changes are being saved. Wait for the result before leaving this reservation." : "You have unsaved changes. Discard them and leave, or continue editing this reservation."}</p>
        <div className="button-row"><button className="btn secondary" onClick={() => blocker.reset()} autoFocus>Continue Editing</button>
            <button className="btn" disabled={busy} onClick={() => blocker.proceed()}>Discard and Leave</button></div>
    </DetailConfirmation>;
}
