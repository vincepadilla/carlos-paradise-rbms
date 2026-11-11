import { useEffect, useRef, type ReactNode } from "react";
import AdminPageHeader from "../../components/admin/AdminPageHeader";
import "./owner.css";

export function OwnerPage({ title, copy, action, eyebrow = "Owner Portal", children }: { title: string; copy: string; action?: ReactNode; eyebrow?: string; children: ReactNode }) {
    return <section className="owner-page" aria-label={title}><AdminPageHeader eyebrow={eyebrow} title={title} copy={copy} action={action} />{children}</section>;
}

export function ActionNotice({ error, notice }: { error: string; notice: string }) {
    return <>{error && <p role="alert" className="owner-error">{error}</p>}{notice && <p role="status" className="owner-notice">{notice}</p>}</>;
}

export function OwnerDialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        ref.current?.showModal();
        return () => previous?.focus();
    }, []);
    return <dialog ref={ref} className="owner-dialog" aria-labelledby="owner-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
        <header><h2 id="owner-dialog-title">{title}</h2><button type="button" className="admin-button" aria-label="Close dialog" disabled={busy} onClick={onClose}>×</button></header>{children}
    </dialog>;
}

export const ownerDate = (value: string) => new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
