import { useEffect, useState } from 'react';

import { AdminApi } from '../services/AdminApi';
import type { DashboardSummary } from '../types/admin';

export function useDashboardSummary() {
    const [summary, setSummary] = useState<DashboardSummary | null>(null);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        let active = true;
        let request: AbortController | null = null;

        const load = async () => {
            request?.abort();
            const controller = new AbortController();
            request = controller;
            try {
                const next = await AdminApi.dashboardSummary(controller.signal);
                if (active) {
                    setSummary(next);
                    setError('');
                }
            } catch (cause) {
                if (active && !controller.signal.aborted) {
                    setError(cause instanceof Error ? cause.message : 'Dashboard totals could not be loaded.');
                }
            }
        };

        void load();
        const timer = window.setInterval(load, 60_000);
        const refreshOnFocus = () => void load();
        const refreshWhenVisible = () => {
            if (document.visibilityState === 'visible') void load();
        };
        window.addEventListener('focus', refreshOnFocus);
        document.addEventListener('visibilitychange', refreshWhenVisible);

        return () => {
            active = false;
            request?.abort();
            window.clearInterval(timer);
            window.removeEventListener('focus', refreshOnFocus);
            document.removeEventListener('visibilitychange', refreshWhenVisible);
        };
    }, [retry]);

    return { summary, error, retry: () => setRetry(value => value + 1) };
}
