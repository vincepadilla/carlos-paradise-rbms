import { operationalApiUrl } from "../../../services/OperationalApi";
import { useEffect, useState } from "react";
import type { ReceiptMetadata } from "../../../types/paymentReview";
import { useAdminSession } from "../../auth/RequireAdmin";
import { DetailPanel } from "../reservation-details/DetailPrimitives";

type ReceiptState = { status: "loading" | "missing" } | { status: "error"; message: string } | { status: "ready"; url: string; mime: string };

export default function ReceiptPreview({ reservationId, paymentId, receipt, cash = false, onReady }: {
    reservationId: number; paymentId: number; receipt?: ReceiptMetadata; cash?: boolean; onReady: (ready: boolean) => void;
}) {
    const [state, setState] = useState<ReceiptState>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);
    const { revalidate } = useAdminSession();
    useEffect(() => {
        const controller = new AbortController();
        let objectUrl: string | undefined;
        onReady(false);
        if (!receipt?.available) { setState({ status: "missing" }); onReady(cash); return; }
        setState({ status: "loading" });
        void (async () => {
            try {
                const response = await fetch(`${operationalApiUrl("/admin")}/reservations/${reservationId}/payments/${paymentId}/receipt`, {
                    credentials: "include", cache: "no-store", signal: controller.signal,
                    headers: { Accept: "image/jpeg, image/png, application/pdf", "X-Requested-With": "XMLHttpRequest" },
                });
                if ([401, 403].includes(response.status)) { revalidate(); throw new Error("Your session cannot access this receipt."); }
                if (response.status === 404) { setState({ status: "missing" }); return; }
                if (!response.ok) throw new Error("Unable to load the receipt. Try again before approving payment.");
                const mime = response.headers.get("Content-Type")?.split(";")[0];
                if (!mime || !["image/jpeg", "image/png", "application/pdf"].includes(mime)) throw new Error("This receipt format cannot be previewed safely.");
                const blob = await response.blob();
                if (controller.signal.aborted) return;
                objectUrl = URL.createObjectURL(blob);
                setState({ status: "ready", url: objectUrl, mime });
                if (mime === "application/pdf") onReady(true);
            } catch (cause) {
                if (!controller.signal.aborted) setState({ status: "error", message: cause instanceof Error ? cause.message : "Unable to load receipt." });
            }
        })();
        return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [reservationId, paymentId, receipt?.available, cash, attempt, revalidate, onReady]);

    return <DetailPanel title="Payment Receipt / Proof" copy={cash ? "Cash records do not require bank or receiving-account proof." : "Inspect the uploaded receipt and verify the transfer against the receiving account."}>
        <div className="receipt-preview">
            {state.status === "loading" && <p role="status">Loading payment receipt…</p>}
            {state.status === "missing" && <p>{cash ? "Cash received — recorded by admin or owner" : "No payment receipt submitted."}</p>}
            {state.status === "error" && <div role="alert"><p>{state.message}</p><button className="btn secondary" onClick={() => setAttempt(value => value + 1)}>Retry receipt</button></div>}
            {state.status === "ready" && <>
                {state.mime === "application/pdf" ? <div className="pdf-receipt"><b>PDF payment receipt</b><p>Open the uploaded PDF to inspect the payment proof.</p></div>
                    : <img src={state.url} alt={`Submitted payment receipt for payment ${paymentId}`} onLoad={() => onReady(true)} onError={() => { onReady(false); setState({ status: "error", message: "The receipt image could not be displayed. Request a readable proof." }); }} />}
                <div className="button-row"><a className="btn secondary" href={state.url} target="_blank" rel="noopener noreferrer">Open full receipt</a>
                    <a className="btn secondary" href={state.url} download={`receipt-${paymentId}.${state.mime === "application/pdf" ? "pdf" : state.mime === "image/png" ? "png" : "jpg"}`}>Download receipt</a></div>
            </>}
        </div>
    </DetailPanel>;
}
