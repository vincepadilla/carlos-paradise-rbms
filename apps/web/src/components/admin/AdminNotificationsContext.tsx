import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AdminApi } from '../../services/AdminApi';

type NotificationState = {
    unreadCount: number;
    notificationWasRead: () => void;
};

const Context = createContext<NotificationState | null>(null);

export function useAdminNotifications(): NotificationState {
    const value = useContext(Context);
    if (!value) throw new Error('Admin notifications are only available inside AdminLayout.');
    return value;
}

export default function AdminNotificationsProvider({ children }: { children: ReactNode }) {
    const [unreadCount, setUnreadCount] = useState(0);
    const refreshUnreadCount = useCallback(async () => {
        if (document.visibilityState === 'hidden') return;
        try {
            const result = await AdminApi.unreadNotificationCount();
            setUnreadCount(result.unread_count);
        } catch {
            // The inbox presents actionable errors; navigation retains its last known count.
        }
    }, []);

    useEffect(() => {
        void refreshUnreadCount();
        const interval = window.setInterval(() => void refreshUnreadCount(), 30_000);
        const onVisibility = () => { if (document.visibilityState === 'visible') void refreshUnreadCount(); };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [refreshUnreadCount]);

    const notificationWasRead = useCallback(() => setUnreadCount(value => Math.max(0, value - 1)), []);
    return <Context.Provider value={{ unreadCount, notificationWasRead }}>{children}</Context.Provider>;
}
