import { useEffect, useId, useRef, type ReactNode } from "react";

export function DetailPanel({ title, copy, badge, children, className = "" }: {
    title: string; copy?: string; badge?: ReactNode; children: ReactNode; className?: string;
}) {
    return <section className={`panel detail-section ${className}`}>
        <div className="panel-head"><div><h2>{title}</h2>{copy && <p>{copy}</p>}</div>{badge}</div>{children}
    </section>;
}
export function DetailField({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
    return <div className={wide ? "detail-wide" : undefined}><span>{label}</span><b>{children || "Not recorded"}</b></div>;
}
export function PesoInput({ label, value, onChange, error }: {
    label: string; value: string | null; onChange?: (value: string) => void; error?: string | null;
}) {
    const id = useId();
    return <label htmlFor={id}>{label}<span className={`price-currency-input${onChange ? "" : " is-disabled"}`}>
        {value !== null && <span aria-hidden="true">₱</span>}
        <input id={id} inputMode="decimal" value={value ?? ""} placeholder="Not recorded" disabled={!onChange}
            aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
            onChange={event => onChange?.(event.target.value)} />
    </span>{error && <small id={`${id}-error`} className="field-error">{error}</small>}</label>;
}
export function DetailConfirmation({ title, busy, onClose, children }: {
    title: string; busy: boolean; onClose: () => void; children: ReactNode;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useEffect(() => {
        const element = dialog.current;
        const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        element?.showModal();
        return () => { element?.close(); trigger?.focus(); };
    }, []);
    return <dialog ref={dialog} className="reservation-detail-dialog" aria-labelledby={titleId}
        onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
        <span className="eyebrow">Carlos Paradise Reservation</span><h2 id={titleId}>{title}</h2>{children}
    </dialog>;
}
