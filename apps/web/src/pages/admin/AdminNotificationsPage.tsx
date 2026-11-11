import { StaffLink as Link } from "../../components/admin/StaffRouting";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from "react-router";
import AdminPagination from '../../components/admin/AdminPagination';
import { useAdminNotifications } from '../../components/admin/AdminNotificationsContext';
import { AdminApi } from '../../services/AdminApi';
import type { AdminNotification, Paginated } from '../../types/admin';
import ComposeEmailModal from '../../components/admin/notifications/ComposeEmailModal';
import SentEmailHistory from '../../components/admin/notifications/SentEmailHistory';

type Tab = 'inbox' | 'sent';
const tabs: Array<{ id: Tab; label: string; panel: string }> = [
    { id: 'inbox', label: 'Admin Inbox', panel: 'notification-inbox-panel' },
    { id: 'sent', label: 'Sent History', panel: 'notification-sent-panel' },
];

function notificationTime(value: string): string {
    return new Intl.DateTimeFormat('en-PH', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
    }).format(new Date(value));
}

export default function AdminNotificationsPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const rawTab = searchParams.get('tab');
    const activeTab: Tab = rawTab === 'sent' ? 'sent' : 'inbox';
    const [page, setPage] = useState(1);
    const [result, setResult] = useState<Paginated<AdminNotification> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reading, setReading] = useState<Set<number>>(new Set());
    const [reload, setReload] = useState(0);
    const [composeOpen, setComposeOpen] = useState(false);
    const [sentVersion, setSentVersion] = useState(0);
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const { unreadCount, notificationWasRead } = useAdminNotifications();

    useEffect(() => {
        if (rawTab !== 'inbox' && rawTab !== 'sent') setSearchParams({ tab: 'inbox' }, { replace: true });
    }, [rawTab, setSearchParams]);

    const load = useCallback(async (signal?: AbortSignal, quiet = false) => {
        if (!quiet) setLoading(true);
        setError(null);
        try {
            const data = await AdminApi.notifications(page, signal);
            setResult(data);
        } catch (cause) {
            if (signal?.aborted) return;
            setError(cause instanceof Error ? cause.message : 'Notifications could not be loaded.');
        } finally {
            if (!signal?.aborted && !quiet) setLoading(false);
        }
    }, [page]);

    useEffect(() => {
        if (activeTab !== 'inbox') return;
        const controller = new AbortController();
        void load(controller.signal);
        const interval = window.setInterval(() => {
            if (document.visibilityState === 'visible') void load(undefined, true);
        }, 30_000);
        return () => { controller.abort(); window.clearInterval(interval); };
    }, [activeTab, load, reload]);

    function selectTab(tab: Tab, focus = false) {
        setSearchParams({ tab });
        if (focus) window.requestAnimationFrame(() => tabRefs.current[tabs.findIndex(item => item.id === tab)]?.focus());
    }

    function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else return;
        event.preventDefault();
        selectTab(tabs[next].id, true);
    }

    async function markRead(notification: AdminNotification) {
        if (notification.read_at || reading.has(notification.id)) return;
        setReading(current => new Set(current).add(notification.id));
        try {
            const response = await AdminApi.markNotificationRead(notification.id);
            setResult(current => current ? {
                ...current,
                data: current.data.map(item => item.id === notification.id ? { ...item, read_at: response.read_at } : item),
            } : current);
            notificationWasRead();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'The notification could not be marked as read.');
        } finally {
            setReading(current => { const next = new Set(current); next.delete(notification.id); return next; });
        }
    }

    return <section className='admin-notifications-page' aria-labelledby='notification-center-title'>
        <header className='admin-notifications-heading'>
            <div>
                <h1 id='notification-center-title'>Notification Center</h1>
                <p>Review system alerts and send privacy-safe email updates to a guest account.</p>
            </div>
            <button type='button' className='admin-compose-email' onClick={() => setComposeOpen(true)}>Compose Email</button>
        </header>

        <div className='admin-notification-tabs' role='tablist' aria-label='Notification Center sections'>
            {tabs.map((tab, index) => <button key={tab.id} id={`notification-${tab.id}-tab`} type='button' role='tab'
                ref={element => { tabRefs.current[index] = element; }} aria-selected={activeTab === tab.id}
                aria-controls={tab.panel} tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => selectTab(tab.id)} onKeyDown={event => onTabKeyDown(event, index)}>
                {tab.label}
                {tab.id === 'inbox' && unreadCount > 0 && <span className='admin-notification-tab-count' aria-label={`${unreadCount} unread`}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </button>)}
        </div>

        {activeTab === 'inbox' ? <div id='notification-inbox-panel' role='tabpanel' aria-labelledby='notification-inbox-tab' tabIndex={0}>
            <div className='admin-notification-card'>
                {loading && <div className='admin-notification-state' role='status'>Loading notifications…</div>}
                {!loading && error && <div className='admin-notification-state admin-notification-error' role='alert'>
                    <p>{error}</p><button type='button' onClick={() => setReload(value => value + 1)}>Try again</button>
                </div>}
                {!loading && !error && result?.data.length === 0 && <div className='admin-notification-state'>
                    <strong>No notifications yet</strong><p>Reservation and payment alerts will appear here when they occur.</p>
                </div>}
                {!loading && !error && result && result.data.length > 0 && <ul className='admin-notification-list'>
                    {result.data.map(notification => <li key={notification.id} className={notification.read_at ? '' : 'admin-notification-unread'}>
                        <span className='admin-notification-dot' aria-hidden='true' />
                        <Link to={notification.destination} className='admin-notification-copy'>
                            <strong>{notification.title}</strong>
                            <span>{notification.description}</span>
                            <small>{notification.read_at ? 'Read' : 'New notification'} · {notificationTime(notification.occurred_at)}</small>
                        </Link>
                        {!notification.read_at && <button type='button' className='admin-mark-read'
                            disabled={reading.has(notification.id)} onClick={() => void markRead(notification)}>
                            {reading.has(notification.id) ? 'Marking…' : 'Mark as Read'}
                        </button>}
                    </li>)}
                </ul>}
            </div>
            {!loading && !error && result && result.last_page > 1 && <AdminPagination page={result.current_page}
                lastPage={result.last_page} total={result.total} onChange={setPage} />}
        </div> : <div id='notification-sent-panel' role='tabpanel' aria-labelledby='notification-sent-tab' tabIndex={0}>
            <SentEmailHistory version={sentVersion} />
        </div>}
        <ComposeEmailModal open={composeOpen} onClose={() => setComposeOpen(false)} onCreated={() => {
            setSentVersion(value => value + 1); selectTab('sent');
        }} />
    </section>;
}
