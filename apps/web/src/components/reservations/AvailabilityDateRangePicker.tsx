import { useEffect, useMemo, useRef, useState } from 'react';
import { reservationApi } from '../../services/ReservationApi';

type AvailabilityCategory = 'available' | 'queue' | 'blocked';
type SelectionTarget = 'checkin' | 'checkout';

interface Props {
    initialCheckin: string;
    initialCheckout: string;
    initialSelection: SelectionTarget;
    earliest: string;
    latest: string;
    reservationType: 'overnight' | 'day_tour';
    durationDays: number;
    checkinTime: string;
    checkoutTime: string;
    onApply: (checkin: string, checkout: string) => void;
    onClose: () => void;
}

const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parseDate = (value: string) => new Date(`${value}T12:00:00`);
const dateValue = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const addDays = (value: string, days: number) => {
    const date = parseDate(value);
    date.setDate(date.getDate() + days);
    return dateValue(date);
};
const addMonths = (value: Date, months: number) =>
    new Date(value.getFullYear(), value.getMonth() + months, 1, 12);
const monthLabel = (value: Date) =>
    value.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
const fullDateLabel = (value: string) =>
    parseDate(value).toLocaleDateString('en-PH', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });

function monthGrid(month: Date) {
    const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12);
    const start = new Date(first);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(last);
    end.setDate(end.getDate() + (6 - end.getDay()));
    const days: Array<{ date: string; inMonth: boolean }> = [];
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
        days.push({ date: dateValue(cursor), inMonth: cursor.getMonth() === month.getMonth() });
    }
    return { start: dateValue(start), end: dateValue(end), days };
}

export default function AvailabilityDateRangePicker({
    initialCheckin, initialCheckout, initialSelection, earliest, latest,
    reservationType, durationDays, checkinTime, checkoutTime, onApply, onClose,
}: Props) {
    const [draftCheckin, setDraftCheckin] = useState(initialCheckin);
    const [draftCheckout, setDraftCheckout] = useState(initialCheckout);
    const [selecting, setSelecting] = useState<SelectionTarget>(
        reservationType === 'overnight' && initialSelection === 'checkout' && initialCheckin ? 'checkout' : 'checkin',
    );
    const [hovered, setHovered] = useState('');
    const [baseMonth, setBaseMonth] = useState(() => {
        const seed = initialSelection === 'checkout' ? initialCheckout || initialCheckin : initialCheckin;
        const date = seed ? parseDate(seed) : parseDate(earliest);
        return new Date(date.getFullYear(), date.getMonth(), 1, 12);
    });
    const [availability, setAvailability] = useState<Record<string, AvailabilityCategory>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const requestSequence = useRef(0);
    const dialogRef = useRef<HTMLDivElement>(null);
    const months = useMemo(() => [baseMonth, addMonths(baseMonth, 1)], [baseMonth]);
    const grids = useMemo(() => months.map(monthGrid), [months]);
    const checkoutMode = selecting === 'checkout' && Boolean(draftCheckin);

    useEffect(() => {
        dialogRef.current?.focus();
    }, []);

    useEffect(() => {
        const sequence = ++requestSequence.current;
        const controller = new AbortController();
        setLoading(true);
        setError('');
        const requests = grids.map(async (grid) => {
            const params = new URLSearchParams({
                start: grid.start,
                end: grid.end,
                type: reservationType,
                duration_days: String(reservationType === 'day_tour' ? 0 : Math.max(1, durationDays)),
                checkin_time: checkinTime,
                checkout_time: checkoutTime,
                date_role: checkoutMode ? 'checkout' : 'checkin',
            });
            if (checkoutMode) params.set('anchor_date', draftCheckin);
            return reservationApi<{ dates: Record<string, AvailabilityCategory> }>(
                `/availability?${params.toString()}`,
                'GET',
                undefined,
                controller.signal,
            );
        });
        Promise.all(requests)
            .then((results) => {
                if (sequence !== requestSequence.current) return;
                const next: Record<string, AvailabilityCategory> = {};
                results.forEach((result) => Object.assign(next, result.dates));
                setAvailability(next);
            })
            .catch((cause: unknown) => {
                if (!controller.signal.aborted && sequence === requestSequence.current) {
                    setError(cause instanceof Error ? cause.message : 'Availability could not be loaded.');
                }
            })
            .finally(() => {
                if (sequence === requestSequence.current) setLoading(false);
            });
        return () => controller.abort();
    }, [grids, reservationType, durationDays, checkinTime, checkoutTime, checkoutMode, draftCheckin, retry]);

    const chooseDate = (date: string) => {
        if (loading || error || availability[date] === 'blocked') return;
        if (selecting === 'checkin') {
            setDraftCheckin(date);
            if (reservationType === 'day_tour') {
                setDraftCheckout(date);
            } else {
                setDraftCheckout('');
                setSelecting('checkout');
            }
        } else {
            setDraftCheckout(date);
        }
        setHovered('');
    };

    const moveFocus = (date: string, days: number) => {
        const targetDate = addDays(date, days);
        const target = document.getElementById(`range-date-${targetDate}`);
        if (target && target.offsetParent !== null) return target.focus();
        const next = parseDate(targetDate);
        setBaseMonth(new Date(next.getFullYear(), next.getMonth(), 1, 12));
        window.setTimeout(() => document.getElementById(`range-date-${targetDate}`)?.focus(), 0);
    };

    const previewEnd = selecting === 'checkout' && hovered ? hovered : draftCheckout;
    const rangeEnd = previewEnd && draftCheckin && previewEnd >= draftCheckin ? previewEnd : '';
    const checkoutCategory = availability[draftCheckout];
    const canApply = Boolean(
        draftCheckin && draftCheckout && (checkoutCategory === 'available' || checkoutCategory === 'queue') && !loading && !error,
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d261f]/45 p-3" onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
        }}>
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="date-range-title" tabIndex={-1}
                onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
                className="max-h-[calc(100vh-1.5rem)] w-full max-w-[760px] overflow-y-auto rounded-2xl border border-[#e3d9cb] bg-[#fffaf2] p-4 shadow-2xl outline-none sm:p-6">
                <div className="mb-4">
                    <div>
                        <h2 id="date-range-title" className="text-lg font-extrabold text-[#2d261f]">Select reservation dates</h2>
                        <p className="mt-1 text-sm text-[#776f65]">
                            {reservationType === 'day_tour'
                                ? 'Choose a date for your day tour.'
                                : selecting === 'checkin' ? 'Choose a check-in date.' : 'Now choose a valid check-out date.'}
                        </p>
                    </div>
                </div>

                <div className="mb-3 grid grid-cols-[44px_1fr_44px] items-center">
                    <button type="button" onClick={() => setBaseMonth(addMonths(baseMonth, -1))} aria-label="Previous month"
                        className="h-10 rounded-lg border border-[#e3d9cb] bg-white text-xl text-[#4a3426] hover:bg-[#f3eadc]">‹</button>
                    <div className="grid grid-cols-1 text-center font-extrabold text-[#2d261f] md:grid-cols-2">
                        <span>{monthLabel(months[0])}</span><span className="hidden md:block">{monthLabel(months[1])}</span>
                    </div>
                    <button type="button" onClick={() => setBaseMonth(addMonths(baseMonth, 1))} aria-label="Next month"
                        className="h-10 rounded-lg border border-[#e3d9cb] bg-white text-xl text-[#4a3426] hover:bg-[#f3eadc]">›</button>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    {months.map((month, monthIndex) => (
                        <div key={dateValue(month)} className={monthIndex === 1 ? 'hidden md:block' : ''}>
                            <div className="grid grid-cols-7 text-center text-[11px] font-bold uppercase tracking-wide text-[#8a7c6c]">
                                {weekDays.map((day) => <span key={day} className="py-2">{day}</span>)}
                            </div>
                            <div className="grid grid-cols-7 gap-y-1">
                                {grids[monthIndex].days.map(({ date, inMonth }) => {
                                    if (!inMonth) return <span key={date} aria-hidden="true" className="h-10" />;
                                    const category = availability[date];
                                    const disabled = loading || Boolean(error) || category === 'blocked' || date < earliest || date > latest;
                                    const endpoint = date === draftCheckin || date === draftCheckout;
                                    const inRange = Boolean(draftCheckin && rangeEnd && date >= draftCheckin && date <= rangeEnd);
                                    const label = `${fullDateLabel(date)}${category === 'blocked' ? ', unavailable' : category === 'queue' ? ', reservation opportunity conflict' : ''}`;
                                    return (
                                        <div key={date} className="relative flex h-10 items-center justify-center"
                                            onMouseEnter={() => { if (selecting === 'checkout' && !disabled) setHovered(date); }}
                                            onMouseLeave={() => setHovered('')}>
                                            {inRange && <span aria-hidden="true" className={`absolute inset-x-0 h-8 bg-[#eee3d2] ${date === draftCheckin ? 'rounded-l-full' : ''} ${date === rangeEnd ? 'rounded-r-full' : ''}`} />}
                                            <button id={`range-date-${date}`} type="button" disabled={disabled} aria-label={label}
                                                aria-pressed={endpoint} onClick={() => chooseDate(date)}
                                                onKeyDown={(event) => {
                                                    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
                                                    if (offsets[event.key]) { event.preventDefault(); moveFocus(date, offsets[event.key]); }
                                                }}
                                                className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#b08a52] focus-visible:ring-offset-2 ${endpoint ? 'bg-[#4a3426] text-white' : disabled ? 'cursor-not-allowed text-[#b7aca0] line-through' : 'text-[#2d261f] hover:bg-[#dcc9aa]'}`}>
                                                {parseDate(date).getDate()}
                                                {category === 'queue' && !endpoint && <span aria-hidden="true" className="absolute bottom-0.5 h-1.5 w-1.5 rounded-full bg-[#b08a52]" />}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-4 min-h-6 text-sm" aria-live="polite">
                    {loading && <p className="text-[#776f65]">Loading current availability…</p>}
                    {!loading && error && <p role="alert" className="text-[#a44b45]">{error} <button type="button" onClick={() => setRetry((value) => value + 1)} className="font-bold underline">Try again</button></p>}
                    {!loading && !error && <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#776f65]">
                        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#b08a52]" />Opportunity conflict — selectable</span>
                        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#b7aca0]" />Unavailable</span>
                    </div>}
                </div>

                <div className="mt-5 flex flex-col-reverse gap-3 border-t border-[#e3d9cb] pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-[#5f554b]">
                        {draftCheckin ? fullDateLabel(draftCheckin) : 'Check-in not selected'}
                        {' — '}
                        {draftCheckout ? fullDateLabel(draftCheckout) : 'Check-out not selected'}
                    </p>
                    <div className="flex gap-2 sm:shrink-0">
                        <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-[#d8c9b6] bg-white px-4 font-bold text-[#4a3426]">Cancel</button>
                        <button type="button" disabled={!canApply} onClick={() => onApply(draftCheckin, draftCheckout)}
                            className="min-h-11 rounded-lg bg-[#4a3426] px-5 font-bold text-white hover:bg-[#35251b] disabled:cursor-not-allowed disabled:opacity-45">Select Dates</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
