import { useEffect, useId, useRef, type ReactNode } from "react";

export default function CalendarDialog({ title, eyebrow, headerBadge, className = "", busy = false, onClose, children }: {
    title: string; eyebrow?: string; headerBadge?: ReactNode; className?: string; busy?: boolean; onClose: () => void; children: ReactNode;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useEffect(() => {
        const element = dialog.current;
        element?.showModal();
        return () => element?.close();
    }, []);
    return <dialog ref={dialog} className={`calendar-dialog ${className}`} aria-labelledby={titleId}
        onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}{headerBadge}<h2 id={titleId}>{title}</h2>{children}
    </dialog>;
}
