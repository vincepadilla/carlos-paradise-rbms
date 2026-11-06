import type { Dispatch, SetStateAction } from "react";
import type { ReservationDetailData, ReservationEdit } from "../../../types/reservationDetails";
import { pricePreview, recordedMoney } from "../../../utils/reservationDetails";
import { DetailPanel, PesoInput } from "./DetailPrimitives";

export default function ReservationDamages({ details, total, editing, draft, setDraft, busy }: {
    details?: ReservationDetailData; total: string | null; editing: boolean; draft: ReservationEdit;
    setDraft: Dispatch<SetStateAction<ReservationEdit>>; busy: boolean;
}) {
    const editable = editing && Boolean(details?.capabilities?.can_manage_damages) && !busy;
    const records = editing && draft.damages ? draft.damages : details?.damages;
    function change(index: number, field: "description" | "item_area" | "amount" | "notes", value: string) {
        setDraft(current => ({ ...current, damages: current.damages?.map((record, at) => at === index ? { ...record, [field]: value } : record) }));
    }
    const damageTotal = editing && records ? records.reduce((sum, record) => sum + Math.round(Number(record.amount || 0) * 100), 0) / 100 : details?.totals ? Number(details.totals.damage_total) : null;
    const preview = pricePreview(draft);
    const reservationTotal = editing ? preview.errors.length ? null : preview.total : total === null ? null : Number(total);
    const amountDue = reservationTotal !== null && damageTotal !== null && details?.totals ? Math.max(0, reservationTotal + damageTotal - Number(details.totals.paid)) : null;
    return <DetailPanel title="Damage Records & Charges" copy="Record guest-caused damages separately from the original reservation cost."
        badge={<button className="btn damage-add-button" disabled={!editable} onClick={() => setDraft(current => ({ ...current, damages: [...(current.damages ?? []), { description: "", item_area: "", amount: "", notes: "" }] }))}>Add Damage Record</button>} className="damage-records-section">
        <p className="damage-availability-note">{details?.capabilities?.can_manage_damages ? "Add, edit, or remove damage records in Edit Reservation mode. Changes are saved only after Confirm Update." : "Damage records are editable only during an ongoing confirmed stay. Historical records remain viewable."}</p>
        {records?.length ? <div className="damage-record-list">{records.map((record, index) => <div className="damage-record" key={record.id ?? `new-${index}`}>
            <div className="damage-record-head"><b>Damage Record {index + 1}</b>{editable && <button className="btn secondary" onClick={() => setDraft(current => ({ ...current, damages: current.damages?.filter((_, at) => at !== index) }))}>Remove</button>}</div>
            <div className="damage-record-fields"><label>Damage Description<input value={record.description} disabled={!editable} maxLength={1000} onChange={event => change(index, "description", event.target.value)} /></label>
                <label>Item or Area Damaged<input value={record.item_area} disabled={!editable} maxLength={255} onChange={event => change(index, "item_area", event.target.value)} /></label>
                <PesoInput label="Amount Charged" value={record.amount} onChange={editable ? value => change(index, "amount", value) : undefined} />
                <label>Optional Notes<input value={record.notes ?? ""} disabled={!editable} maxLength={2000} onChange={event => change(index, "notes", event.target.value)} /></label></div>
        </div>)}</div> : <div className="damage-empty">{records ? "No damage has been recorded." : "Damage records are unavailable."}</div>}
        <div className="damage-totals"><div><span>Reservation Total</span><b>{recordedMoney(reservationTotal)}</b></div><div><span>Total Damage Charges</span><b>{damageTotal === null ? "Unavailable" : recordedMoney(damageTotal)}</b></div>
            <div className="final-amount-due"><span>Final Amount Due</span><strong>{amountDue === null ? "Unavailable" : recordedMoney(amountDue)}</strong></div></div>
        <p className="detail-note">Amount due = reservation price + damage charges − verified payments, floored at zero. The refundable security deposit is separate.</p>
        {Number(details?.totals?.credit_balance) > 0 && <p className="detail-note">Recorded payment credit: {recordedMoney(details?.totals?.credit_balance)}. Refunds require separate settlement.</p>}
    </DetailPanel>;
}
