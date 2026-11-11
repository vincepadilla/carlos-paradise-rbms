import { useRef, useState } from "react";
import { OwnerApi } from "../../services/OwnerApi";
import { useOwnerAction } from "../../hooks/useOwnerAction";
import type { BackupValidation } from "../../types/owner";
import { ActionNotice, OwnerPage } from "./OwnerUI";
import { Icon } from "../../components/reservations/ReservationUI";

export default function OwnerDatabasePage() {
    const action = useOwnerAction();
    const input = useRef<HTMLInputElement>(null);
    const [selected, setSelected] = useState<File | null>(null);
    const [validation, setValidation] = useState<BackupValidation | null>(null);
    return <OwnerPage eyebrow="Owner Tools" title="Database" copy="Create a portable system snapshot or inspect a Carlos Paradise backup.">
        <ActionNotice {...action} />
        <section className="owner-card owner-database"><header><div><h2>Database Backup &amp; Restore</h2><p>Keep operational data protected with owner-controlled snapshots.</p></div><span className="owner-badge owner-badge-inactive">Owner Only</span></header>
            <div className="owner-database-actions"><div><span className="owner-database-icon"><Icon name="upload" /></span><div><h3>Back up database</h3><p>Download users, reservation-state, payment metadata, calendar blocks, notifications, settings, and audit data as JSON.</p><small>Recommended before operational changes.</small></div>
                <button className="btn btn-primary" disabled={action.busy} onClick={() => void action.run(OwnerApi.downloadBackup, "Application backup downloaded.")}>{action.busy ? "Working…" : "Download Backup"}</button>
            </div><div><span className="owner-database-icon restore"><Icon name="credit" /></span><div><h3>Restore database</h3><p>Select a Carlos Paradise JSON backup for format validation. Inspection does not change resort records.</p><small>{selected ? selected.name : "No backup file selected."}</small></div>
            <input ref={input} hidden type="file" accept=".json,application/json" aria-label="Backup file" disabled={action.busy} onChange={event => { setSelected(event.target.files?.[0] ?? null); setValidation(null); }} />
            <div className="owner-actions"><button className="admin-button" disabled={action.busy} onClick={() => input.current?.click()}>Choose Backup</button>
                <button className="admin-button" disabled={!selected || action.busy} onClick={() => void action.run(async () => {
                    if (!selected) return;
                    const form = new FormData(); form.set("file", selected); setValidation(await OwnerApi.validateBackup(form));
                })}>Validate Backup</button>
                <button className="btn btn-primary" disabled title="Automatic restore is not supported">Restore Backup</button></div></div></div>
            {validation && <div className="owner-notice" role="status"><p>{validation.message}</p><p>{Object.keys(validation.tables).length} tables · {Object.values(validation.tables).reduce((sum, count) => sum + count, 0)} records</p></div>}
            <p className="owner-help owner-database-limit">Automatic restore is unavailable. Passwords, authentication tokens, private file paths, receipt files, and PDFs are excluded. Keep a separate verified database and private-file backup for disaster recovery.</p>
        </section>
    </OwnerPage>;
}
