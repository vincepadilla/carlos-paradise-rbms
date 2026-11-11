import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AdminApi } from '../../../services/AdminApi';
import { ReservationApiError } from '../../../services/ReservationApi';
import type { ReservationCreationGuest, ReservationCreationOptions, ReservationCreationPreview } from '../../../types/admin';
import './admin-reservation-modal.css';

type Step = 0 | 1 | 2 | 3;
type GuestMode = 'existing' | 'new';
type StayType = 'overnight' | 'day_tour';
type Draft = {
    guestMode: GuestMode; guestId: number | null; guestName: string; contactNumber: string; email: string; inquirySource: string;
    stayType: StayType; checkInDate: string; duration: number; checkInTime: string; checkOutDate: string; checkOutTime: string;
    adults: number; children: number; pets: number; bonfireWood: number; charcoal: number; liquor: number; specialRequests: string;
};

const steps = ['Guest', 'Stay', 'Details', 'Review'] as const;
function localDate(offset = 0) { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function addDays(value: string, days: number) { if (!value) return ''; const [year, month, day] = value.split('-').map(Number); const date = new Date(year, month - 1, day + days); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function displayDate(value: string) { if (!value) return 'Not provided'; const [year, month, day] = value.split('-').map(Number); return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day)); }
function displayTime(value: string) { if (!value) return 'Not provided'; const [hour, minute] = value.split(':').map(Number); return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(new Date(2020, 0, 1, hour, minute)); }
function money(value: number) { return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value); }
function quantity(value: number, label: string) { return `${value} ${label}${value === 1 ? '' : 's'}`; }
function Field({ label, children, full = false, error }: { label: string; children: ReactNode; full?: boolean; error?: string }) { return <label className={`admin-create-field${full ? ' admin-create-field-full' : ''}`}><span>{label}</span>{children}{error && <small className='admin-create-error'>{error}</small>}</label>; }

const initialDraft: Draft = {
    guestMode: 'existing', guestId: null, guestName: '', contactNumber: '', email: '', inquirySource: '', stayType: 'overnight',
    checkInDate: localDate(2), duration: 1, checkInTime: '14:00', checkOutDate: localDate(3), checkOutTime: '11:00',
    adults: 1, children: 0, pets: 0, bonfireWood: 0, charcoal: 0, liquor: 0, specialRequests: '',
};

export default function AdminReservationModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const requestKey = useRef(crypto.randomUUID());
    const [step, setStep] = useState<Step>(0);
    const [draft, setDraft] = useState<Draft>(initialDraft);
    const [options, setOptions] = useState<ReservationCreationOptions | null>(null);
    const [preview, setPreview] = useState<ReservationCreationPreview | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [guestSearch, setGuestSearch] = useState('');
    const [guestResults, setGuestResults] = useState<ReservationCreationGuest[]>([]);
    const [searching, setSearching] = useState(false);

    useEffect(() => { const dialog = dialogRef.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
    useEffect(() => {
        const controller = new AbortController();
        AdminApi.reservationCreationOptions(controller.signal).then(data => {
            setOptions(data);
            const earliest = localDate(data.limits.min_lead_days);
            const overnight = data.stay_options.find(item => item.value === 'overnight');
            setDraft(current => ({ ...current, checkInDate: earliest, checkOutDate: addDays(earliest, 1), checkInTime: overnight?.checkin_time ?? '14:00', checkOutTime: overnight?.checkout_time ?? '11:00' }));
        }).catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Unable to load reservation settings.'); });
        return () => controller.abort();
    }, []);
    useEffect(() => {
        if (draft.guestMode !== 'existing' || guestSearch.trim().length < 2) { setGuestResults([]); setSearching(false); return; }
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            setSearching(true);
            AdminApi.reservationCreationGuests(guestSearch.trim(), controller.signal)
                .then(data => setGuestResults(data.guests))
                .catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Guest search failed.'); })
                .finally(() => { if (!controller.signal.aborted) setSearching(false); });
        }, 250);
        return () => { window.clearTimeout(timer); controller.abort(); };
    }, [draft.guestMode, guestSearch]);

    const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
        setDraft(current => ({ ...current, [key]: value })); setPreview(null); setMessage('');
        setErrors(current => { const next = { ...current }; delete next[key]; return next; });
    };
    const selectGuest = (guest: ReservationCreationGuest) => {
        setDraft(current => ({ ...current, guestId: guest.id, guestName: guest.name, email: guest.email, contactNumber: guest.phone ?? '' }));
        setGuestSearch(guest.name); setGuestResults([]); setErrors({}); setMessage(''); setPreview(null);
    };
    const switchGuestMode = (mode: GuestMode) => {
        setDraft(current => ({ ...current, guestMode: mode, guestId: null, guestName: '', email: '', contactNumber: '' }));
        setGuestSearch(''); setGuestResults([]); setErrors({}); setMessage(''); setPreview(null);
    };
    const chooseStay = (type: StayType) => {
        const configured = options?.stay_options.find(item => item.value === type);
        setDraft(current => ({ ...current, stayType: type, duration: type === 'day_tour' ? 1 : Math.max(1, current.duration), checkInTime: configured?.checkin_time ?? current.checkInTime, checkOutTime: configured?.checkout_time ?? current.checkOutTime, checkOutDate: addDays(current.checkInDate, type === 'day_tour' ? 0 : Math.max(1, current.duration)) }));
        setPreview(null); setErrors({}); setMessage('');
    };
    const payload = (): Record<string, unknown> => ({
        guest_mode: draft.guestMode, guest_id: draft.guestId, contact_name: draft.guestName.trim(), contact_email: draft.email.trim(), contact_phone: draft.contactNumber.trim(), inquiry_source: draft.inquirySource,
        type: draft.stayType, checkin: draft.checkInDate, checkout: draft.checkOutDate, checkin_time: draft.checkInTime, checkout_time: draft.checkOutTime,
        adults: draft.adults, children: draft.children, pets: draft.pets, bonfire_qty: draft.bonfireWood, charcoal_qty: draft.charcoal, liquor_qty: draft.liquor, notes: draft.specialRequests.trim() || null,
    });
    const applyError = (cause: unknown) => {
        if (cause instanceof ReservationApiError && cause.errors) {
            const mapped: Record<string, string> = {};
            Object.entries(cause.errors).forEach(([key, values]) => { mapped[key] = values[0] ?? 'Invalid value.'; });
            setErrors(mapped);
        }
        setMessage(cause instanceof Error ? cause.message : 'The request could not be completed.');
    };
    const localValid = () => {
        const next: Record<string, string> = {};
        if (step === 0) {
            if (draft.guestMode === 'existing' && !draft.guestId) next.guest_id = 'Search for and select an existing guest.';
            if (!draft.guestName.trim()) next.contact_name = 'Enter the guest name.';
            if (!/^09[0-9]{9}$/.test(draft.contactNumber.trim())) next.contact_phone = 'Use an 11-digit mobile number beginning with 09.';
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) next.contact_email = 'Enter a valid email address.';
            if (!draft.inquirySource) next.inquiry_source = 'Select an inquiry source.';
        }
        if (step === 1) {
            if (!draft.checkInDate) next.checkin = 'Select a check-in date.';
            if (!draft.checkOutDate) next.checkout = 'Select a check-out date.';
            if (draft.duration < 1) next.duration = 'Duration must be at least 1.';
        }
        if (step === 2 && draft.adults < 1) next.adults = 'At least one adult is required.';
        setErrors(next); return Object.keys(next).length === 0;
    };
    const continueToNext = async (event: FormEvent) => {
        event.preventDefault(); if (!localValid()) return;
        if (step < 2) { setStep(current => (current + 1) as Step); return; }
        setBusy(true); setMessage('');
        try { const result = await AdminApi.previewReservationCreation(payload()); setPreview(result); setStep(3); }
        catch (cause) { applyError(cause); }
        finally { setBusy(false); }
    };
    const save = async () => {
        if (!preview || preview.availability === 'blocked' || busy) return;
        setBusy(true); setMessage('');
        try {
            const result = await AdminApi.createReservation({ ...payload(), request_key: requestKey.current, expected_total: preview.quote.total, queue_acknowledged: preview.availability === 'queue' });
            onCreated(result.reservation.id);
        } catch (cause) { applyError(cause); }
        finally { setBusy(false); }
    };
    const services = [draft.bonfireWood ? quantity(draft.bonfireWood, 'bonfire wood bundle') : '', draft.charcoal ? quantity(draft.charcoal, 'charcoal quantity') : '', draft.liquor ? `${quantity(draft.liquor, 'liquor item')} at ${money(options?.rates.liquor ?? 0)} each` : ''].filter(Boolean);

    return <dialog ref={dialogRef} className='admin-create-dialog' aria-labelledby='admin-create-title' onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose}>
        <div className='admin-create-modal'>
            <header className='admin-create-header'><div><span className='admin-create-eyebrow'>Staff-created reservation</span><h2 id='admin-create-title'>Make a Reservation</h2><p>Create a reservation on behalf of a guest.</p></div><div className='admin-create-header-actions'><span className='admin-create-badge'>Admin creating</span><button type='button' className='admin-create-close' onClick={onClose} aria-label='Close reservation form'>x</button></div></header>
            <ol className='admin-create-progress' aria-label='Reservation creation progress'>{steps.map((label, index) => <li key={label} className={index < step ? 'complete' : index === step ? 'current' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? 'Done' : index + 1}</span><b>{label}</b></li>)}</ol>
            <form className='admin-create-body' onSubmit={continueToNext} noValidate>
                {!options && <section className='admin-create-loading' aria-live='polite'>{message || 'Loading reservation settings...'}</section>}
                {options && step === 0 && <section aria-labelledby='admin-create-guest'>
                    <div className='admin-create-section-title'><span>01</span><div><h3 id='admin-create-guest'>Guest</h3><p>Enter reservation contact details without changing the guest profile.</p></div></div>
                    <fieldset className='admin-create-choice admin-create-field-full'><legend>Guest Selection</legend><label className={draft.guestMode === 'existing' ? 'selected' : ''}><input type='radio' name='guest-mode' checked={draft.guestMode === 'existing'} onChange={() => switchGuestMode('existing')} /><span><b>Existing Guest</b><small>Search active guest accounts</small></span></label><label className={draft.guestMode === 'new' ? 'selected' : ''}><input type='radio' name='guest-mode' checked={draft.guestMode === 'new'} onChange={() => switchGuestMode('new')} /><span><b>New Guest</b><small>Create an account without inventing a password</small></span></label></fieldset>
                    {draft.guestMode === 'existing' && <div className='admin-create-guest-search'><Field label='Search Guest Accounts' full error={errors.guest_id}><input autoFocus type='search' value={guestSearch} onChange={event => { setGuestSearch(event.target.value); update('guestId', null); }} placeholder='Search by name, email, or contact number' aria-autocomplete='list' /></Field>{searching && <small>Searching...</small>}{guestResults.length > 0 && <ul role='listbox'>{guestResults.map(guest => <li key={guest.id}><button type='button' onClick={() => selectGuest(guest)}><b>{guest.name}</b><span>{guest.email} - {guest.phone || 'No profile contact number'}</span></button></li>)}</ul>}</div>}
                    {draft.guestMode === 'new' && <p className='admin-create-integration-note'>A guest account will be created with no password. An existing email cannot be reused or overwritten.</p>}
                    <div className='admin-create-grid'><Field label='Guest Name' error={errors.contact_name}><input autoFocus={draft.guestMode === 'new'} type='text' value={draft.guestName} onChange={event => update('guestName', event.target.value)} autoComplete='name' aria-invalid={Boolean(errors.contact_name)} /></Field><Field label='Contact Number' error={errors.contact_phone}><input type='tel' value={draft.contactNumber} onChange={event => update('contactNumber', event.target.value)} autoComplete='tel' placeholder='09XXXXXXXXX' aria-invalid={Boolean(errors.contact_phone)} /></Field><Field label='Email Address' error={errors.contact_email}><input type='email' value={draft.email} onChange={event => update('email', event.target.value)} autoComplete='email' aria-invalid={Boolean(errors.contact_email)} /></Field><Field label='Inquiry Source' error={errors.inquiry_source}><select value={draft.inquirySource} onChange={event => update('inquirySource', event.target.value)} aria-invalid={Boolean(errors.inquiry_source)}><option value=''>-Select option-</option>{options.inquiry_sources.map(source => <option key={source}>{source}</option>)}</select></Field></div>
                </section>}
                {options && step === 1 && <section aria-labelledby='admin-create-stay'>
                    <div className='admin-create-section-title'><span>02</span><div><h3 id='admin-create-stay'>Stay</h3><p>Choose the reservation type and schedule in Asia/Manila.</p></div></div>
                    <fieldset className='admin-create-choice admin-create-field-full'><legend>Stay Type</legend>{options.stay_options.map(item => <label key={item.value} className={draft.stayType === item.value ? 'selected' : ''}><input type='radio' name='stay-type' checked={draft.stayType === item.value} onChange={() => chooseStay(item.value)} /><span><b>{item.label}</b><small>{displayTime(item.checkin_time)} to {displayTime(item.checkout_time)}</small></span></label>)}</fieldset>
                    <div className='admin-create-grid'><Field label='Check-in Date' error={errors.checkin}><input autoFocus type='date' min={localDate(options.limits.min_lead_days)} value={draft.checkInDate} onChange={event => { const value = event.target.value; setDraft(current => ({ ...current, checkInDate: value, checkOutDate: addDays(value, current.stayType === 'day_tour' ? 0 : current.duration) })); setPreview(null); }} aria-invalid={Boolean(errors.checkin)} /></Field><Field label='Stay Duration' error={errors.duration}><input type='number' min='1' max='30' value={draft.duration} onChange={event => { const value = Math.max(1, Number(event.target.value) || 1); setDraft(current => ({ ...current, duration: value, checkOutDate: addDays(current.checkInDate, current.stayType === 'day_tour' ? 0 : value) })); setPreview(null); }} disabled={draft.stayType === 'day_tour'} /></Field><Field label='Check-in Time' error={errors.checkin_time}><input type='time' value={draft.checkInTime} onChange={event => update('checkInTime', event.target.value)} readOnly={draft.stayType === 'overnight'} /></Field><Field label='Check-out Date' error={errors.checkout}><input type='date' value={draft.checkOutDate} onChange={event => update('checkOutDate', event.target.value)} readOnly={draft.stayType === 'day_tour'} /></Field><Field label='Check-out Time' error={errors.checkout_time}><input type='time' value={draft.checkOutTime} onChange={event => update('checkOutTime', event.target.value)} readOnly={draft.stayType === 'overnight'} /></Field></div>
                </section>}
                {options && step === 2 && <section aria-labelledby='admin-create-details'>
                    <div className='admin-create-section-title'><span>03</span><div><h3 id='admin-create-details'>Details</h3><p>Add guest counts, configured services, and requests.</p></div></div>
                    <div className='admin-create-grid'><Field label='Adults' error={errors.adults}><input autoFocus type='number' min='1' max={options.limits.max_guests} value={draft.adults} onChange={event => update('adults', Math.max(0, Number(event.target.value) || 0))} /></Field><Field label='Children aged 8+' error={errors.children}><input type='number' min='0' max={options.limits.max_guests} value={draft.children} onChange={event => update('children', Math.max(0, Number(event.target.value) || 0))} /></Field><Field label='Pets' error={errors.pets}><input type='number' min='0' max='10' value={draft.pets} onChange={event => update('pets', Math.max(0, Number(event.target.value) || 0))} /></Field><Field label='Bonfire Wood Bundles' error={errors.bonfire_qty}><input type='number' min='0' max='20' value={draft.bonfireWood} onChange={event => update('bonfireWood', Math.max(0, Number(event.target.value) || 0))} /></Field><Field label='Charcoal Quantity' error={errors.charcoal_qty}><input type='number' min='0' max='100' value={draft.charcoal} onChange={event => update('charcoal', Math.max(0, Number(event.target.value) || 0))} /></Field><Field label='Liquor Quantity' error={errors.liquor_qty}><input type='number' min='0' max='100' value={draft.liquor} onChange={event => update('liquor', Math.max(0, Number(event.target.value) || 0))} /></Field><Field label='Liquor Amount Each'><input type='text' value={money(options.rates.liquor)} disabled aria-label='Configured liquor amount each' /></Field><Field label='Special Requests' full error={errors.notes}><textarea rows={4} maxLength={2000} value={draft.specialRequests} onChange={event => update('specialRequests', event.target.value)} placeholder='Accessibility needs, celebration notes, or other requests' /></Field></div>
                </section>}
                {options && step === 3 && preview && <section aria-labelledby='admin-create-review'>
                    <div className='admin-create-section-title'><span>04</span><div><h3 id='admin-create-review'>Review</h3><p>Server-validated details, pricing, and availability.</p></div></div>
                    <div className={`admin-create-availability admin-create-availability-${preview.availability}`}><b>{preview.availability === 'available' ? 'Available' : preview.availability === 'queue' ? `Waiting queue - estimated position ${preview.queue_position ?? '-'}` : 'Unavailable'}</b><span>{preview.availability === 'available' ? 'Availability will be checked again when saving.' : preview.availability === 'queue' ? 'This request will follow the existing deposit opportunity queue.' : 'Choose another schedule before saving.'}</span></div>
                    <div className='admin-create-review-grid'><article><h4>Guest</h4><strong>{draft.guestName}</strong><p>{draft.contactNumber}<br />{draft.email}</p><small>{draft.guestMode === 'existing' ? `Existing guest account #${preview.guest.id}` : 'New guest account'} - {draft.inquirySource}</small></article><article><h4>Created By</h4><strong>{preview.creator.name}</strong><p>{preview.creator.role === 'owner' ? 'Owner' : 'Admin'} - authenticated staff account</p></article><article><h4>Stay</h4><strong>{draft.stayType === 'overnight' ? 'Overnight Stay' : 'Day Tour'}</strong><p>{displayDate(draft.checkInDate)}, {displayTime(draft.checkInTime)}<br />to {displayDate(draft.checkOutDate)}, {displayTime(draft.checkOutTime)}</p><small>{draft.duration} day{draft.duration === 1 ? '' : 's'} - Asia/Manila</small></article><article><h4>Guest Count</h4><strong>{draft.adults + draft.children} guests</strong><p>{quantity(draft.adults, 'adult')} - {quantity(draft.children, 'child aged 8+')} - {quantity(draft.pets, 'pet')}</p></article><article><h4>Additional Services</h4><strong>{services.length ? services.join(' - ') : 'None selected'}</strong><p>Additional charges: {money(preview.quote.optional_fee)}<br />Special requests: {draft.specialRequests.trim() || 'None'}</p></article><article className='admin-create-estimate'><h4>Reservation Cost Estimate</h4><strong>{money(preview.quote.total)}</strong><p>Deposit required: {money(preview.quote.deposit)}<br />Refundable security deposit: {money(preview.quote.security_deposit)} (not included)</p></article></div>
                </section>}
                {message && options && <p className='admin-create-submit-error' role='alert'>{message}</p>}
                <footer className='admin-create-footer'><div>{step === 3 && <small>{busy ? 'Saving reservation...' : 'Saving rechecks pricing and availability before creating the unpaid reservation.'}</small>}</div><div>{step === 0 ? <button type='button' className='secondary' onClick={onClose}>Cancel</button> : <button type='button' className='secondary' disabled={busy} onClick={() => { setMessage(''); setErrors({}); setStep(current => Math.max(0, current - 1) as Step); }}>Back</button>}{step < 3 ? <button type='submit' className='primary' disabled={!options || busy}>{busy ? 'Checking...' : 'Continue'}</button> : <button type='button' className='primary' disabled={!preview || preview.availability === 'blocked' || busy} onClick={() => void save()}>{busy ? 'Saving...' : 'Save Reservation'}</button>}</div></footer>
            </form>
        </div>
    </dialog>;
}
