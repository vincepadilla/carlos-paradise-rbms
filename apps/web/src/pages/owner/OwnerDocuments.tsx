import { useCallback, useRef, useState, type FormEvent } from "react";
import AdminResource from "../../components/admin/AdminResource";
import { OwnerApi } from "../../services/OwnerApi";
import { useOwnerAction } from "../../hooks/useOwnerAction";
import type { DocumentHistory } from "../../types/owner";
import { ActionNotice, ownerDate } from "./OwnerUI";
import { Icon } from "../../components/reservations/ReservationUI";

function DocumentContent({ initial, documentKey, title }: { initial: DocumentHistory; documentKey: string; title: string }) {
    const [data, setData] = useState(initial);
    const [notes, setNotes] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const action = useOwnerAction();
    const active = data.versions.find(version => version.id === data.active_version_id);
    function submit(event: FormEvent) {
        event.preventDefault();
        void action.run(async () => {
            if (!file) throw new Error("Choose a PDF to upload.");
            const body = new FormData(); body.set("key", documentKey); body.set("file", file); body.set("notes", notes);
            setData(await OwnerApi.uploadDocument(body)); setFile(null); setNotes("");
            if (input.current) input.current.value = "";
        }, "New document version is active. Previous versions are preserved.");
    }
    return <section className="owner-document-card"><div className="owner-document-active"><span className="owner-file-icon"><Icon name="credit" /></span><div><h3>{title}.pdf</h3><p>{active ? `Version ${active.version} · ${(active.size / 1024).toFixed(0)} KB` : "No active version"}</p></div><span className={`owner-badge${active ? "" : " owner-badge-inactive"}`}>{active ? "Active" : "Missing"}</span></div>
        <div className="owner-document-body"><ActionNotice {...action} />
            {active && <div className="owner-table-actions mb-5"><a className="admin-button" href={OwnerApi.documentUrl(active.id, true)} target="_blank" rel="noopener noreferrer">Preview</a><a className="admin-button" href={OwnerApi.documentUrl(active.id)}>Download</a></div>}
            <form onSubmit={submit} className="owner-document-form">
                <label className="owner-field">Upload replacement PDF<input ref={input} type="file" accept=".pdf,application/pdf" required disabled={action.busy} onChange={e => setFile(e.target.files?.[0] ?? null)} /><small>PDF only, up to 10 MB.</small></label>
                <label className="owner-field">Version Notes (optional)<input name="notes" maxLength={5000} value={notes} disabled={action.busy} placeholder="What changed in this version?" onChange={e => setNotes(e.target.value)} /></label>
                <button className="btn btn-primary" disabled={!file || action.busy}>{action.busy ? "Uploading…" : "Upload as New Active Version"}</button>
            </form>
        </div>
        <div className="owner-document-history"><header><b>Version History</b><span>{data.versions.length} versions</span></header>{data.versions.map(version => <div className="owner-version-row" key={version.id}><span><b>v{version.version} {version.id === data.active_version_id && "· Active"}</b><small>{ownerDate(version.created_at)} · {version.uploaded_by}</small></span><span>{version.notes || "No version notes provided."}</span><div><a href={OwnerApi.documentUrl(version.id, true)} target="_blank" rel="noopener noreferrer">Preview</a><a href={OwnerApi.documentUrl(version.id)}>Download</a></div></div>)}</div>
    </section>;
}

function DocumentCard({ documentKey, title }: { documentKey: string; title: string }) {
    const load = useCallback((signal: AbortSignal) => OwnerApi.documents(documentKey, signal), [documentKey]);
    return <AdminResource load={load} showRefresh={false}>{data => <DocumentContent initial={data} documentKey={documentKey} title={title} />}</AdminResource>;
}

export default function OwnerDocuments() {
    return <><div className="owner-document-intro"><div><span className="owner-kicker">Owner Controlled</span><h3>Official Email Documents</h3><p>Replacements create a new immutable version. Existing sent and queued emails keep the PDF versions originally attached.</p></div><span className="owner-badge">Version history enabled</span></div>
        <div className="owner-document-grid"><DocumentCard documentKey="house-rules-policies" title="House Rules & Policies" /><DocumentCard documentKey="waiver-form" title="Waiver Form" /></div>
    </>;
}
