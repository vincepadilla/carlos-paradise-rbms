import { useMemo, useState } from 'react';
import type { Payment } from '../../../types/reservation';
import type { PaymentReviewData } from '../../../types/paymentReview';
import { AdminApi } from '../../../services/AdminApi';
import { DetailConfirmation } from '../reservation-details/DetailPrimitives';

export type StaffEditKind = 'reservation' | 'terms' | 'payment';
type Props = { kind: StaffEditKind; data: PaymentReviewData; payment?: Payment; onClose: () => void; onSaved: (data: PaymentReviewData, message: string) => void };
type Draft = Record<string, string | number | boolean | File | null>;

const parts = (value: string) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(new Date(value)).map(part => [part.type, part.value]));
const localDate = (value: string) => { const p = parts(value); return `${p.year}-${p.month}-${p.day}`; };
const localTime = (value: string) => { const p = parts(value); return `${p.hour}:${p.minute}`; };
const localDateTime = (value: string) => `${localDate(value)}T${localTime(value)}`;
const labels: Record<string, string> = {
    contact_name: 'Guest name', contact_email: 'Email', contact_phone: 'Contact number', type: 'Visit type', checkin: 'Check-in date', checkout: 'Check-out date',
    checkin_time: 'Check-in time', checkout_time: 'Check-out time', adults: 'Adults', children: 'Children', pets: 'Pets', bonfire_qty: 'Bonfire quantity',
    charcoal_qty: 'Charcoal quantity', liquor_qty: 'Liquor quantity', notes: 'Special requests', required_deposit: 'Required deposit', deadline: 'Deposit deadline',
    partial_payment_authorized: 'Partial payments', partial_payment_terms: 'Partial-payment terms', amount: 'Payment amount', method: 'Payment method', reference: 'Reference',
    payment_date: 'Payment date', payment_notes: 'Payment notes', receipt: 'Receipt', discount_type: 'Discount type', discount_value: 'Discount value', discount_justification: 'Discount reason',
    base: 'Base price', holiday_fee: 'Holiday fee', extra_fee: 'Extra guest fee', cleaning_fee: 'Cleaning fee', bonfire: 'Bonfire price', charcoal: 'Charcoal price', liquor: 'Liquor price', other: 'Other charges',
};

function initial(kind: StaffEditKind, data: PaymentReviewData, payment?: Payment): Draft {
    const r = data.reservation, editing = data.editing;
    if (kind === 'terms') return {
        required_deposit: r.deposit, deadline: r.deadline ? localDateTime(r.deadline) : '', partial_payment_authorized: Boolean(r.partial_payment_authorized), partial_payment_terms: r.partial_payment_terms ?? '', reason: '',
    };
    if (kind === 'payment') return {
        amount: payment?.amount ?? '', method: payment?.method ?? '', reference: payment?.reference ?? '', payment_date: payment?.payment_date ?? '', payment_notes: payment?.staff_notes ?? '', receipt: null, reason: '',
    };
    return {
        contact_name: r.contact_name, contact_email: r.contact_email, contact_phone: r.contact_phone, type: r.type,
        checkin: localDate(r.starts_at), checkout: localDate(r.ends_at), checkin_time: localTime(r.starts_at), checkout_time: localTime(r.ends_at),
        adults: r.adults, children: r.children, pets: r.pets, bonfire_qty: r.bonfire_qty ?? 0, charcoal_qty: r.charcoal_qty ?? 0, liquor_qty: r.liquor_qty ?? 0,
        notes: r.notes ?? '', ...(editing?.pricing ?? {}), discount_type: editing?.discount.type ?? 'none', discount_value: editing?.discount.value ?? '0.00',
        discount_justification: editing?.discount.justification ?? '', reason: '',
    };
}

const display = (value: Draft[string]) => value instanceof File ? value.name : typeof value === 'boolean' ? value ? 'Authorized' : 'Not authorized' : String(value || 'Not recorded');

export default function StaffEditDialog({ kind, data, payment, onClose, onSaved }: Props) {
    const original = useMemo(() => initial(kind, data, payment), [kind, data, payment]);
    const [draft, setDraft] = useState<Draft>(original);
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const changes = Object.keys(draft).filter(key => key !== 'reason' && display(draft[key]) !== display(original[key]));
    const set = (key: string, value: Draft[string]) => setDraft(current => ({ ...current, [key]: value }));
    const title = kind === 'reservation' ? 'Edit Reservation' : kind === 'terms' ? 'Edit Deposit Terms' : 'Edit Payment Details';

    function review(event: React.FormEvent) {
        event.preventDefault(); setError(null);
        if (String(draft.reason).trim().length < 3) return setError('Enter a reason of at least 3 characters.');
        if (!changes.length) return setError('Change at least one saved value before continuing.');
        setConfirming(true);
    }

    async function save() {
        if (busy) return;
        setBusy(true); setError(null);
        try {
            let updated: PaymentReviewData;
            if (kind === 'reservation') {
                const priceKeys = ['base', 'holiday_fee', 'extra_fee', 'cleaning_fee', 'bonfire', 'charcoal', 'liquor', 'other'];
                updated = await AdminApi.updatePaymentReviewReservation(data.reservation.id, {
                    revision: data.reservation.revision, reason: String(draft.reason).trim(), contact_name: draft.contact_name, contact_email: draft.contact_email,
                    contact_phone: draft.contact_phone, type: draft.type, checkin: draft.checkin, checkout: draft.checkout, checkin_time: draft.checkin_time, checkout_time: draft.checkout_time,
                    adults: Number(draft.adults), children: Number(draft.children), pets: Number(draft.pets), bonfire_qty: Number(draft.bonfire_qty), charcoal_qty: Number(draft.charcoal_qty), liquor_qty: Number(draft.liquor_qty),
                    notes: draft.notes, pricing: Object.fromEntries(priceKeys.map(key => [key, draft[key]])),
                    discount: { type: draft.discount_type, value: draft.discount_value, justification: draft.discount_justification },
                });
            } else if (kind === 'terms') {
                updated = await AdminApi.updateDepositTerms(data.reservation.id, {
                    revision: data.reservation.revision, reason: String(draft.reason).trim(), required_deposit: draft.required_deposit,
                    deadline: draft.deadline, partial_payment_authorized: draft.partial_payment_authorized, partial_payment_terms: draft.partial_payment_terms,
                });
            } else {
                if (!payment) throw new Error('No payment was selected.');
                const form = new FormData();
                const values = { revision: data.reservation.revision ?? 0, payment_revision: payment.revision ?? 0, reason: String(draft.reason).trim(), amount: draft.amount,
                    method: draft.method, reference: draft.reference, payment_date: draft.payment_date, notes: draft.payment_notes };
                Object.entries(values).forEach(([key, value]) => form.append(key, String(value ?? '')));
                if (draft.receipt instanceof File) form.append('receipt', draft.receipt);
                updated = await AdminApi.updateStaffPayment(data.reservation.id, payment.id, form);
            }
            onSaved(updated, `${title} saved. Totals and statuses have been refreshed.`);
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save these changes.'); setConfirming(false); }
        finally { setBusy(false); }
    }

    return <DetailConfirmation title={confirming ? `Confirm ${title}` : title} busy={busy} onClose={onClose}>
        {confirming ? <div className='staff-edit-confirm'><p>Confirm the following audited changes before saving:</p><dl>{changes.map(key => <div key={key}><dt>{labels[key] ?? key}</dt><dd><del>{display(original[key])}</del><span>→</span><ins>{display(draft[key])}</ins></dd></div>)}</dl>
            <p><b>Reason:</b> {display(draft.reason)}</p>{error && <p className='detail-error' role='alert'>{error}</p>}<div className='button-row'><button className='btn secondary' disabled={busy} onClick={() => setConfirming(false)}>Back</button><button className='btn' disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Confirm and Save'}</button></div></div>
        : <form className='staff-edit-form' onSubmit={review}><div className='staff-edit-grid'>
            {kind === 'reservation' && <ReservationFields draft={draft} set={set} />}
            {kind === 'terms' && <TermsFields draft={draft} set={set} />}
            {kind === 'payment' && <PaymentFields draft={draft} set={set} methods={data.payment_methods} />}
            <label className='staff-edit-wide'>Reason for change<textarea required minLength={3} maxLength={1000} value={String(draft.reason)} onChange={event => set('reason', event.target.value)} /></label>
        </div>{error && <p className='detail-error' role='alert'>{error}</p>}<div className='button-row'><button className='btn secondary' type='button' onClick={onClose}>Cancel</button><button className='btn' type='submit'>Review Changes</button></div></form>}
    </DetailConfirmation>;
}

const Field = ({ label, name, draft, set, type = 'text', min }: { label: string; name: string; draft: Draft; set: (key: string, value: Draft[string]) => void; type?: string; min?: number }) =>
    <label>{label}<input type={type} min={min} required value={String(draft[name] ?? '')} onChange={event => set(name, type === 'number' ? Number(event.target.value) : event.target.value)} /></label>;

function ReservationFields({ draft, set }: { draft: Draft; set: (key: string, value: Draft[string]) => void }) {
    const prices = ['base', 'holiday_fee', 'extra_fee', 'cleaning_fee', 'bonfire', 'charcoal', 'liquor', 'other'];
    return <><Field label='Guest name' name='contact_name' draft={draft} set={set} /><Field label='Email' name='contact_email' type='email' draft={draft} set={set} /><Field label='Contact number' name='contact_phone' type='tel' draft={draft} set={set} />
        <label>Visit type<select value={String(draft.type)} onChange={event => set('type', event.target.value)}><option value='overnight'>Overnight Stay</option><option value='day_tour'>Day Tour</option></select></label>
        <Field label='Check-in date' name='checkin' type='date' draft={draft} set={set} /><Field label='Check-in time' name='checkin_time' type='time' draft={draft} set={set} /><Field label='Check-out date' name='checkout' type='date' draft={draft} set={set} /><Field label='Check-out time' name='checkout_time' type='time' draft={draft} set={set} />
        {['adults', 'children', 'pets', 'bonfire_qty', 'charcoal_qty', 'liquor_qty'].map(key => <Field key={key} label={labels[key]} name={key} type='number' min={key === 'adults' ? 1 : 0} draft={draft} set={set} />)}
        <label className='staff-edit-wide'>Special requests<textarea maxLength={2000} value={String(draft.notes)} onChange={event => set('notes', event.target.value)} /></label>
        <h3 className='staff-edit-wide'>Pricing and discount</h3>{prices.map(key => <Field key={key} label={labels[key]} name={key} type='number' min={0} draft={draft} set={set} />)}
        <label>Discount type<select value={String(draft.discount_type)} onChange={event => set('discount_type', event.target.value)}><option value='none'>No discount</option><option value='percentage'>Percentage</option><option value='fixed'>Fixed amount</option></select></label>
        <Field label='Discount value' name='discount_value' type='number' min={0} draft={draft} set={set} /><label className='staff-edit-wide'>Discount justification<textarea maxLength={2000} value={String(draft.discount_justification)} onChange={event => set('discount_justification', event.target.value)} /></label></>;
}

function TermsFields({ draft, set }: { draft: Draft; set: (key: string, value: Draft[string]) => void }) {
    return <><Field label='Required deposit' name='required_deposit' type='number' min={1} draft={draft} set={set} /><Field label='Deposit deadline' name='deadline' type='datetime-local' draft={draft} set={set} />
        <label className='staff-edit-check'><input type='checkbox' checked={Boolean(draft.partial_payment_authorized)} onChange={event => set('partial_payment_authorized', event.target.checked)} />Authorize partial deposit payments</label>
        <label className='staff-edit-wide'>Authorized partial-payment terms<textarea disabled={!draft.partial_payment_authorized} required={Boolean(draft.partial_payment_authorized)} maxLength={2000} value={String(draft.partial_payment_terms)} onChange={event => set('partial_payment_terms', event.target.value)} /></label></>;
}

function PaymentFields({ draft, set, methods }: { draft: Draft; set: (key: string, value: Draft[string]) => void; methods: string[] }) {
    return <><Field label='Amount' name='amount' type='number' min={1} draft={draft} set={set} /><label>Payment method<select required value={String(draft.method)} onChange={event => set('method', event.target.value)}>{methods.map(method => <option key={method}>{method}</option>)}</select></label>
        <Field label='Reference' name='reference' draft={draft} set={set} /><Field label='Payment date' name='payment_date' type='date' draft={draft} set={set} />
        <label className='staff-edit-wide'>Staff notes<textarea maxLength={2000} value={String(draft.payment_notes)} onChange={event => set('payment_notes', event.target.value)} /></label>
        <label className='staff-edit-wide'>Replace receipt (optional)<input type='file' accept='.jpg,.jpeg,.png,.pdf' onChange={event => set('receipt', event.target.files?.[0] ?? null)} /><small>The prior receipt remains retained in the adjustment audit.</small></label></>;
}
