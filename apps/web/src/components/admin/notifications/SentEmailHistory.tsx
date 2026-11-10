import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AdminApi } from '../../../services/AdminApi';
import type { OutgoingEmail, Paginated } from '../../../types/admin';
import AdminPagination from '../AdminPagination';

const emailTime = (value: string | null) => value ? new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
}).format(new Date(value)) : '—';

function EmailDetails({ id, onClose }: { id: number; onClose: () => void }) {
    const [email, setEmail] = useState<OutgoingEmail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const close = useRef<HTMLButtonElement>(null);
    const previous = useRef(document.activeElement as HTMLElement | null);
    useEffect(() => {
        const previousElement = previous.current;
        const controller = new AbortController();
        AdminApi.outgoingEmail(id, controller.signal).then(result => setEmail(result.email))
            .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Email details could not be loaded.'); });
        const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        document.addEventListener('keydown', keydown); close.current?.focus();
        return () => { controller.abort(); document.removeEventListener('keydown', keydown); previousElement?.focus(); };
    }, [id, onClose]);

    return createPortal(<div className='email-modal-backdrop email-detail-backdrop' onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
    }}><section className='email-detail-modal' role='dialog' aria-modal='true' aria-labelledby='email-detail-title'>
        <header><div><span>OUTGOING EMAIL</span><h2 id='email-detail-title'>{email?.subject ?? 'Email details'}</h2></div>
            <button ref={close} type='button' aria-label='Close email details' onClick={onClose}>×</button></header>
        {error ? <p role='alert' className='email-form-error'>{error}</p> : !email ? <p role='status'>Loading email details…</p> : <div className='email-detail-content'>
            <dl>
                <div><dt>Recipient</dt><dd>{email.recipient_name}<small>{email.recipient_email}</small></dd></div>
                <div><dt>Reservation</dt><dd>{email.reservation_reference}</dd></div>
                <div><dt>Sender</dt><dd>{email.sender_name}<small>{email.sender_email}</small></dd></div>
                <div><dt>Status</dt><dd><span className={`email-status email-status-${email.status}`}>{email.status}</span></dd></div>
                <div><dt>Scheduled</dt><dd>{emailTime(email.scheduled_for)}</dd></div>
                <div><dt>Queued</dt><dd>{emailTime(email.queued_at)}</dd></div>
                <div><dt>Sent</dt><dd>{emailTime(email.sent_at)}</dd></div>
                <div><dt>Failed</dt><dd>{emailTime(email.failed_at)}</dd></div>
                <div><dt>Created</dt><dd>{emailTime(email.created_at)}</dd></div>
            </dl>
            <div className='email-detail-message'><span>Message</span><p>{email.message}</p></div>
            <div className='email-detail-attachments'><span>Attachments</span>
                {email.attachments?.length ? <ul>{email.attachments.map(item => <li key={item.key}>{item.label}</li>)}</ul> : <p>No attachments selected.</p>}
            </div>
            {email.failure_message && <p className='email-form-error'><strong>Failure:</strong> {email.failure_message}</p>}
        </div>}
    </section></div>, document.body);
}

export default function SentEmailHistory({ version }: { version: number }) {
    const [page, setPage] = useState(1);
    const [result, setResult] = useState<Paginated<OutgoingEmail> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const [selected, setSelected] = useState<number | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true); setError(null);
        AdminApi.outgoingEmails(page, controller.signal).then(setResult)
            .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Sent history could not be loaded.'); })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [page, retry, version]);

    if (loading) return <div className='admin-notification-sent-empty' role='status'>Loading sent history…</div>;
    if (error) return <div className='admin-notification-sent-empty email-history-error' role='alert'>
        <p>{error}</p><button type='button' onClick={() => setRetry(value => value + 1)}>Try again</button>
    </div>;
    if (!result?.data.length) return <div className='admin-notification-sent-empty'>
        <strong>No sent emails yet</strong><p>Submitted guest emails will appear here.</p>
    </div>;

    return <>
        <div className='email-history-card'>
            <div className='admin-table-scroll'><table className='email-history-table'>
                <thead><tr><th>Recipient</th><th>Subject</th><th>Category</th><th>Reservation</th><th>Scheduled / Sent</th><th>Status</th></tr></thead>
                <tbody>{result.data.map(email => <tr key={email.id}>
                    <td><button type='button' onClick={() => setSelected(email.id)}><strong>{email.recipient_name}</strong><small>{email.recipient_email}</small></button></td>
                    <td>{email.subject}</td><td>{email.category_label}</td><td>{email.reservation_reference}</td>
                    <td>{emailTime(email.sent_at ?? email.scheduled_for ?? email.created_at)}</td>
                    <td><span className={`email-status email-status-${email.status}`}>{email.status}</span></td>
                </tr>)}</tbody>
            </table></div>
        </div>
        {result.last_page > 1 && <AdminPagination page={result.current_page} lastPage={result.last_page} total={result.total} onChange={setPage} />}
        {selected !== null && <EmailDetails id={selected} onClose={() => setSelected(null)} />}
    </>;
}
