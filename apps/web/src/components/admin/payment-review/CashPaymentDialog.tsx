import { useState } from 'react';
import type { PaymentReviewData } from '../../../types/paymentReview';
import { AdminApi } from '../../../services/AdminApi';
import { useAdminSession } from '../../auth/RequireAdmin';
import { DetailConfirmation } from '../reservation-details/DetailPrimitives';

const receivedNow = () => {
    const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
};

export default function CashPaymentDialog({ data, onClose, onSaved }: {
    data: PaymentReviewData; onClose: () => void; onSaved: (updated: PaymentReviewData, message: string) => void;
}) {
    const { user, revalidate } = useAdminSession();
    const [amount, setAmount] = useState('');
    const [receivedAt, setReceivedAt] = useState(receivedNow);
    const [receiptNumber, setReceiptNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [attachment, setAttachment] = useState<File | null>(null);
    const [acknowledged, setAcknowledged] = useState(false);
    const [requestKey] = useState(() => crypto.randomUUID());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (busy || Number(amount) <= 0 || !acknowledged) return;
        setBusy(true); setError(null);
        const form = new FormData();
        Object.entries({ revision: data.reservation.revision ?? 0, request_key: requestKey, amount, received_at: receivedAt,
            receipt_number: receiptNumber.trim(), notes: notes.trim(), confirmed_received: acknowledged ? '1' : '0' })
            .forEach(([key, value]) => form.append(key, String(value)));
        if (attachment) form.append('receipt', attachment);
        try {
            const updated = await AdminApi.recordCashPayment(data.reservation.id, form);
            const message = data.can_approve_payments
                ? 'Cash payment recorded and verified. Reservation totals and status were refreshed.'
                : 'Cash payment recorded for authorized review. Reservation totals and status were refreshed.';
            onSaved(updated, message);
        } catch (cause) {
            if (cause && typeof cause === 'object' && 'status' in cause && [401, 403].includes(Number(cause.status))) revalidate();
            setError(cause instanceof Error ? cause.message : 'Unable to record this cash payment.');
        } finally { setBusy(false); }
    }

    return <DetailConfirmation title='Record Cash Payment' busy={busy} onClose={onClose}>
        <form className='staff-edit-form' onSubmit={submit}><div className='staff-edit-grid'>
            <label>Amount Received<input type='number' inputMode='decimal' min='0.01' step='0.01' required value={amount} onChange={event => setAmount(event.target.value)} /></label>
            <label>Date/Time Received<input type='datetime-local' required value={receivedAt} onChange={event => setReceivedAt(event.target.value)} /></label>
            <label>Payment Method<input value='Cash' readOnly /></label>
            <label>Receipt Number<input required maxLength={100} value={receiptNumber} onChange={event => setReceiptNumber(event.target.value)} /></label>
            <div className='cash-receiver staff-edit-wide'><span>Receiving staff member</span><b>{user.name} — {user.role === 'owner' ? 'Owner' : 'Admin'}</b></div>
            <label className='staff-edit-wide'>Notes<textarea maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
            <label className='staff-edit-wide'>Optional receipt attachment<input type='file' accept='.jpg,.jpeg,.png,.pdf' onChange={event => setAttachment(event.target.files?.[0] ?? null)} /><small>No transfer proof or bank-account information is required for cash.</small></label>
            <label className='cash-acknowledgment staff-edit-wide'><input type='checkbox' required checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I confirm this cash payment was received</label>
        </div><p className='verification-neutral'>{data.can_approve_payments ? 'Your account can verify this payment immediately. Confirmation still requires full deposit coverage, availability, and an active opportunity.' : 'This payment will be saved as Awaiting Review for an authorized approver.'}</p>
        {error && <p className='detail-error' role='alert'>{error}</p>}<div className='button-row'><button className='btn secondary' type='button' disabled={busy} onClick={onClose}>Cancel</button><button className='btn' type='submit' disabled={busy || Number(amount) <= 0 || !acknowledged}>{busy ? 'Recording…' : 'Record Cash Payment'}</button></div></form>
    </DetailConfirmation>;
}
