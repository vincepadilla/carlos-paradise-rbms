import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { dateTime } from "../../../api";
import { AdminApi } from "../../../services/AdminApi";
import { ReservationApiError } from "../../../services/ReservationApi";
import type { AdminReservation } from "../../../types/admin";
import { useAdminSession } from "../../auth/RequireAdmin";
import AdminResource from "../AdminResource";
import { StaffLink as Link } from "../StaffRouting";
import { DetailConfirmation, DetailPanel } from "./DetailPrimitives";

type Action = { kind: "release" | "extend" } | { kind: "grant"; candidateId: number; releaseId: number };

export default function QueueOpportunityControls({ reservation, disabled, reload }: {
    reservation: AdminReservation; disabled: boolean; reload: () => Promise<void>;
}) {
    const { revalidate } = useAdminSession();
    const [action, setAction] = useState<Action | null>(null);
    const [newDeadline, setNewDeadline] = useState("");
    const [releasedNow, setReleasedNow] = useState<number | null>(null);
    const [refreshCount, setRefreshCount] = useState(0);
    const [notice, setNotice] = useState("");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [now, setNow] = useState(Date.now);
    const pending = useRef(false);
    const opportunity = reservation.opportunity;
    const releaseId = opportunity?.release_id ?? releasedNow;
    const loadRecommendation = useCallback((signal: AbortSignal) => {
        if (releaseId === null) throw new Error("A release is required.");
        return AdminApi.queueRecommendation(releaseId, signal);
    }, [releaseId]);
    useEffect(() => {
        if (releaseId || !opportunity) return;
        const timer = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(timer);
    }, [releaseId, opportunity]);
    const unpaidHold = opportunity && ["active", "expired"].includes(opportunity.status)
        && ["awaiting_deposit", "held", "expired", "cancelled"].includes(reservation.status);
    if (!unpaidHold && !releaseId) return null;
    const deadlinePassed = opportunity?.status === "expired" ||
        Boolean(reservation.deadline && Date.parse(reservation.deadline) <= now);
    const canExtend = deadlinePassed && reservation.status !== "cancelled" &&
        reservation.extension_status !== "pending" && Date.parse(reservation.starts_at) > now;

    function open(nextAction: Action) {
        setError("");
        setNotice("");
        setNewDeadline("");
        setAction(nextAction);
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!action || pending.current || disabled) return;
        pending.current = true;
        setSaving(true);
        setError("");
        try {
            if (action.kind === "grant") {
                await AdminApi.grantQueueOpportunity(action.candidateId, action.releaseId);
                setRefreshCount(value => value + 1);
                setNotice(`Deposit opportunity granted to reservation #${action.candidateId}.`);
            } else if (action.kind === "extend") {
                await AdminApi.extendHeldOpportunity(reservation.id, newDeadline);
                setNotice("Deposit deadline extended.");
            } else {
                const decision = await AdminApi.releaseOpportunity(reservation.id);
                setReleasedNow(decision.release_id);
                setNotice("Hold released. You can review the queue decision below.");
            }
            await reload();
            setAction(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Unable to save the decision.");
            if (cause instanceof ReservationApiError && [401, 403].includes(cause.status)) revalidate();
            if (cause instanceof ReservationApiError && cause.status === 409) {
                setAction(null);
                setRefreshCount(value => value + 1);
                await reload();
            }
        } finally {
            pending.current = false;
            setSaving(false);
        }
    }

    return <DetailPanel title="Reservation opportunity"><div className="queue-decision">
        {notice && <p role="status" className="detail-success">{notice}</p>}
        {error && !action && <p role="alert" className="detail-error">{error}</p>}
        {releaseId ? <AdminResource key={refreshCount} load={loadRecommendation}>
            {decision => {
                const candidate = decision.selected_reservation_id;
                const granted = decision.granted_reservation_id;
                if (granted !== null) return <p>Deposit opportunity granted to <Link to={`/admin/reservations/${granted}`}>reservation #{granted}</Link>.</p>;
                if (candidate === null) return <p>No waiting guest is eligible for these released dates.</p>;
                return <>
                    <p><Link to={`/admin/reservations/${candidate}`}>Reservation #{candidate}</Link> is first in line among {decision.eligible_candidates} eligible {decision.eligible_candidates === 1 ? "request" : "requests"}.</p>
                    <button className="btn" disabled={disabled || saving || !decision.approval_required}
                        onClick={() => open({ kind: "grant", candidateId: candidate, releaseId })}>Review deposit opportunity</button>
                </>;
            }}
        </AdminResource> : <>
            <p>{deadlinePassed ? "The payment window has ended. The dates remain protected until staff release the hold."
                : "The deposit opportunity is holding these dates."}</p>
            <div className="button-row">
                <button className="btn secondary" disabled={disabled || saving} onClick={() => open({ kind: "release" })}>Release hold</button>
                {canExtend && <button className="btn secondary" disabled={disabled || saving} onClick={() => open({ kind: "extend" })}>Extend deposit deadline</button>}
            </div>
        </>}
        {action && <DetailConfirmation title={action.kind === "grant" ? "Grant this deposit opportunity?" : action.kind === "extend" ? "Extend the deposit deadline?" : "Release this hold?"}
            busy={saving} onClose={() => { setAction(null); setError(""); }}>
            <form onSubmit={submit}>
                {action.kind === "grant" && <p>Allow <b>reservation #{action.candidateId}</b> to pay the required deposit for its stay?</p>}
                {action.kind === "release" && <p>End the deposit opportunity for <b>{reservation.reference}</b> for {dateTime(reservation.starts_at)} to {dateTime(reservation.ends_at)}. You can then review the earliest eligible waiting request.</p>}
                {action.kind === "extend" && <label className="queue-extension-deadline">New deposit deadline (Manila time)
                    <input type="datetime-local" required disabled={saving} value={newDeadline} onChange={event => setNewDeadline(event.target.value)} />
                    <small>Choose a future time before check-in on {dateTime(reservation.starts_at)}.</small>
                </label>}
                {error && <p role="alert" className="detail-error">{error}</p>}
                <div className="button-row">
                    <button type="button" className="btn secondary" autoFocus disabled={saving} onClick={() => { setAction(null); setError(""); }}>Cancel</button>
                    <button type="submit" className="btn" disabled={saving}>{saving ? "Saving…" : action.kind === "grant" ? "Approve opportunity" : action.kind === "extend" ? "Extend deadline" : "Confirm release"}</button>
                </div>
            </form>
        </DetailConfirmation>}
    </div></DetailPanel>;
}
