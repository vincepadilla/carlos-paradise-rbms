import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AdminApi } from '../../../services/AdminApi';
import type { ComposeEmailOptions, EmailCategory, EmailRecipient } from '../../../types/admin';

type Props = { open: boolean; onClose: () => void; onCreated: () => void };

const dateText = (value: string) => new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
}).format(new Date(value));

function templateValue(value: string, recipient: EmailRecipient | null): string {
    if (!recipient) return value;
    return value.replaceAll('{{guest_name}}', recipient.name)
        .replaceAll('{{reservation_reference}}', recipient.reservation_reference)
        .replaceAll('{{check_in_date}}', recipient.check_in_date);
}

function manilaInput(value: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export default function ComposeEmailModal({ open, onClose, onCreated }: Props) {
    const dialog = useRef<HTMLDivElement>(null);
    const previousFocus = useRef<HTMLElement | null>(null);
    const [options, setOptions] = useState<ComposeEmailOptions | null>(null);
    const [recipients, setRecipients] = useState<EmailRecipient[]>([]);
    const [search, setSearch] = useState('');
    const [recipient, setRecipient] = useState<EmailRecipient | null>(null);
    const [category, setCategory] = useState('general_update');
    const [subject, setSubject] = useState('');
    const [message, setMessage] = useState('');
    const [attachments, setAttachments] = useState<string[]>([]);
    const [sendTime, setSendTime] = useState('');
    const [loading, setLoading] = useState(false);
    const [searching, setSearching] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
    const [currentTime, setCurrentTime] = useState(() => Date.now());
    const dirty = Boolean(recipient || subject || message || attachments.length || sendTime);

    const suggestion = useMemo(() => recipient
        ? new Date(new Date(recipient.starts_at).getTime() - 7 * 24 * 60 * 60 * 1000)
        : null, [recipient]);
    const suggestionIsFuture = Boolean(suggestion && suggestion.getTime() > currentTime);

    function applyTemplate(item: EmailCategory, selected: EmailRecipient | null) {
        setSubject(templateValue(item.subject, selected));
        setMessage(templateValue(item.message, selected));
    }

    function chooseRecipient(item: EmailRecipient) {
        setRecipient(item);
        const selectedCategory = options?.categories.find(value => value.key === category);
        if (selectedCategory) applyTemplate(selectedCategory, item);
        setErrors(current => ({ ...current, recipient: '' }));
    }

    function requestClose() {
        if (submitting) return;
        if (dirty && !window.confirm('Discard this email draft?')) return;
        onClose();
    }

    const closeRequest = useEffectEvent(requestClose);

    useEffect(() => {
        if (!open) return;
        previousFocus.current = document.activeElement as HTMLElement;
        setCurrentTime(Date.now());
        setSearch(''); setRecipient(null); setCategory('general_update'); setSubject(''); setMessage('');
        setAttachments([]); setSendTime(''); setError(null); setErrors({});
        setIdempotencyKey(crypto.randomUUID());
        const controller = new AbortController();
        setLoading(true);
        Promise.all([AdminApi.emailComposeOptions(controller.signal), AdminApi.emailRecipients('', controller.signal)])
            .then(([catalog, result]) => { setOptions(catalog); setRecipients(result.recipients); })
            .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Composer data could not be loaded.'); })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus());
        const keydown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); closeRequest(); return; }
            if (event.key !== 'Tab' || !dialog.current) return;
            const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex=-1])'));
            if (!focusable.length) return;
            const first = focusable[0]; const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', keydown);
        return () => {
            controller.abort(); document.removeEventListener('keydown', keydown);
            document.body.style.overflow = previousOverflow; previousFocus.current?.focus();
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            setSearching(true);
            AdminApi.emailRecipients(search.trim(), controller.signal)
                .then(result => setRecipients(result.recipients))
                .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Recipient search failed.'); })
                .finally(() => { if (!controller.signal.aborted) setSearching(false); });
        }, 250);
        return () => { window.clearTimeout(timer); controller.abort(); };
    }, [open, search]);

    async function submit(scheduled: boolean) {
        const nextErrors: Record<string, string> = {};
        if (!recipient) nextErrors.recipient = 'Select a reservation recipient.';
        if (!subject.trim()) nextErrors.subject = 'Enter a subject.';
        if (!message.trim()) nextErrors.message = 'Enter a message.';
        if (scheduled && (!sendTime || new Date(`${sendTime}:00+08:00`).getTime() <= Date.now())) {
            nextErrors.sendTime = 'Select a future send time.';
        }
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length) return;

        setSubmitting(true); setError(null);
        const payload: Record<string, unknown> = {
            reservation_id: recipient!.reservation_id, category, subject: subject.trim(),
            message: message.trim(), attachments, idempotency_key: idempotencyKey,
            ...(scheduled ? { scheduled_for: `${sendTime}:00+08:00` } : {}),
        };
        try {
            if (scheduled) await AdminApi.scheduleEmail(payload); else await AdminApi.sendEmail(payload);
            setIdempotencyKey(crypto.randomUUID()); onCreated(); onClose();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'The email could not be submitted.');
        } finally {
            setSubmitting(false);
        }
    }

    if (!open) return null;

    return createPortal(<div className='email-modal-backdrop' onMouseDown={event => {
        if (event.target === event.currentTarget) requestClose();
    }}>
        <div className='email-compose-modal' role='dialog' aria-modal='true' aria-labelledby='compose-email-title' ref={dialog}>
            <header className='email-modal-header'>
                <div><span>GUEST COMMUNICATION</span><h2 id='compose-email-title'>Compose Email</h2>
                    <p>Select one reservation recipient. Internal queue details are never included.</p></div>
                <button type='button' className='email-modal-close' aria-label='Close email composer' onClick={requestClose} data-autofocus>×</button>
            </header>
            <div className='email-modal-body'>
                <section className='email-editor' aria-label='Email editor'>
                    {error && <p className='email-form-error' role='alert'>{error}</p>}
                    <label className='email-field'><span>Recipient</span>
                        <input type='search' value={search} onChange={event => setSearch(event.target.value)}
                            placeholder='Search guest, email, or reservation reference' aria-describedby={errors.recipient ? 'recipient-error' : undefined} />
                    </label>
                    <div className='email-recipient-results' aria-label='Reservation recipients'>
                        {loading || searching ? <p role='status'>Searching recipients…</p> : recipients.length === 0 ? <p>No matching recipients.</p> :
                            recipients.map(item => <button type='button' key={item.reservation_id}
                                className={recipient?.reservation_id === item.reservation_id ? 'selected' : ''}
                                aria-pressed={recipient?.reservation_id === item.reservation_id} onClick={() => chooseRecipient(item)}>
                                <span><strong>{item.name}</strong><small>{item.email}</small></span>
                                <span><strong>{item.reservation_reference}</strong><small>Check-in {item.check_in_date}</small></span>
                            </button>)}
                    </div>
                    {errors.recipient && <small id='recipient-error' className='email-validation'>{errors.recipient}</small>}
                    <label className='email-field'><span>Category</span>
                        <select value={category} onChange={event => {
                            const key = event.target.value; setCategory(key);
                            const item = options?.categories.find(value => value.key === key);
                            if (item) applyTemplate(item, recipient);
                        }}>
                            {options?.categories.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                        </select>
                    </label>
                    <label className='email-field'><span>Subject</span>
                        <input value={subject} maxLength={200} onChange={event => setSubject(event.target.value)} aria-invalid={Boolean(errors.subject)} />
                        {errors.subject && <small className='email-validation'>{errors.subject}</small>}
                    </label>
                    <label className='email-field'><span>Message</span>
                        <textarea value={message} maxLength={10000} rows={8} onChange={event => setMessage(event.target.value)}
                            placeholder='Write a guest-safe email message' aria-invalid={Boolean(errors.message)} />
                        {errors.message && <small className='email-validation'>{errors.message}</small>}
                    </label>
                    <fieldset className='email-attachments'><legend>Attachments</legend>
                        {options?.documents.length ? options.documents.map(document => <label key={document.key}>
                            <input type='checkbox' checked={attachments.includes(document.key)} onChange={event => setAttachments(current =>
                                event.target.checked ? [...current, document.key] : current.filter(key => key !== document.key))} />
                            <span>{document.label}</span>
                        </label>) : <p>No configured documents are available.</p>}
                    </fieldset>
                </section>
                <aside className='email-preview' aria-label='Live email preview' aria-live='polite'>
                    <span className='email-preview-label'>EMAIL PREVIEW</span>
                    <div className='email-recipient-card'>
                        <strong>{recipient?.name ?? 'No recipient selected'}</strong>
                        <span>{recipient?.email ?? 'Select a reservation recipient'}</span>
                        {recipient && <small>{recipient.reservation_reference}</small>}
                    </div>
                    <div className='email-preview-content'>
                        <span>Subject</span><h3>{subject || 'Your subject will appear here'}</h3>
                        <span>Message</span><p>{message || 'Your guest-safe email message will appear here.'}</p>
                    </div>
                    <div className='email-preview-attachments'>
                        <span>Attachments</span>
                        {attachments.length ? <ul>{attachments.map(key => <li key={key}>
                            {options?.documents.find(document => document.key === key)?.label ?? key}
                        </li>)}</ul> : <p>No attachments selected.</p>}
                    </div>
                    {recipient && suggestion && <div className='email-schedule-suggestion'>
                        <span>Seven days before check-in</span>
                        <strong>{dateText(suggestion.toISOString())}</strong>
                        {suggestionIsFuture && <button type='button' onClick={() => setSendTime(manilaInput(suggestion))}>Use this suggestion</button>}
                    </div>}
                    <label className='email-field email-send-time'><span>Send time (Asia/Manila)</span>
                        <input type='datetime-local' value={sendTime} min={manilaInput(new Date(currentTime + 60_000))}
                            onChange={event => { setSendTime(event.target.value); setErrors(current => ({ ...current, sendTime: '' })); }} />
                        <small>Required only when scheduling. Select the time explicitly.</small>
                        {errors.sendTime && <small className='email-validation'>{errors.sendTime}</small>}
                    </label>
                </aside>
            </div>
            <footer className='email-modal-footer'>
                <span>No automatic attachments</span>
                <div>
                    <button type='button' className='email-action-cancel' onClick={requestClose} disabled={submitting}>Cancel</button>
                    <button type='button' className='email-action-schedule' onClick={() => void submit(true)} disabled={submitting || loading}>Schedule Email</button>
                    <button type='button' className='email-action-send' onClick={() => void submit(false)} disabled={submitting || loading}>{submitting ? 'Processing…' : 'Send Email'}</button>
                </div>
            </footer>
        </div>
    </div>, document.body);
}
