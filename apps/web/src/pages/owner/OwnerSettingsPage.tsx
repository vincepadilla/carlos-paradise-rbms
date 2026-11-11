import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import AdminResource from "../../components/admin/AdminResource";
import { OwnerApi } from "../../services/OwnerApi";
import { useOwnerAction } from "../../hooks/useOwnerAction";
import { ActionNotice, OwnerPage } from "./OwnerUI";
import OwnerDocuments from "./OwnerDocuments";
import OwnerPaymentAccounts from "./OwnerPaymentAccounts";
import { settingsFields, settingsSections, type SettingField, type SettingsSection } from "./ownerSettingsFields";
import { Icon, type IconName } from "../../components/reservations/ReservationUI";

const sectionDescriptions: Record<SettingsSection, [IconName, string]> = {
    "Resort Information": ["home", "Public identity and contact details"],
    "Reservation Settings": ["calendar", "Deposits, booking windows, and stay schedules"],
    "Guest Capacity": ["people", "Included guests, capacity, and additional guest fees"],
    "Payment Settings": ["credit", "Payment instructions and receiving accounts"],
    "Amenities & Inclusions": ["sparkle", "Facilities and inclusions for your guests"],
    "Landing Page Content": ["home", "Public resort content and presentation"],
    "Pricing": ["credit", "Accommodation rates and optional charges"],
    "Policies": ["shield", "House rules and resort policies"],
    "Notifications": ["clock", "Operational notifications and guest messages"],
    "Document Management": ["credit", "Official PDF templates, active versions, and history"],
};

function SettingsField({ field, value, onChange, disabled }: { field: SettingField; value: string; onChange: (value: string) => void; disabled: boolean }) {
    return <label className={`owner-field${field.type === "textarea" ? " owner-field-wide" : ""}`}>{field.label}
        {field.type === "textarea" ? <textarea name={field.key} value={value} maxLength={field.key === "address" ? 1000 : field.key === "description" ? 5000 : 10000} disabled={disabled} onChange={e => onChange(e.target.value)} />
            : <input name={field.key} type={field.type ?? "text"} value={value} min={field.min} max={field.max ?? (field.type === "number" ? 99999999 : undefined)} step={field.step} maxLength={255} required={field.type === "number" || field.type === "time" || field.key === "name"} disabled={disabled} onChange={e => onChange(e.target.value)} />}
        {field.help && <small>{field.help}</small>}
    </label>;
}

function SectionForm({ section, settings, onSaved }: { section: SettingsSection; settings: Record<string, unknown>; onSaved: (settings: Record<string, unknown>) => void }) {
    const fields = settingsFields[section] ?? [];
    const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(field => [field.key, String(settings[field.key] ?? "")])));
    const action = useOwnerAction();
    function submit(event: FormEvent) {
        event.preventDefault();
        void action.run(async () => {
            const data = Object.fromEntries(fields.map(field => [field.key, field.type === "number" ? Number(values[field.key]) : values[field.key]]));
            onSaved((await OwnerApi.saveSettings(data)).settings);
        }, "Settings saved. Existing reservation and payment records are preserved.");
    }
    return <><form onSubmit={submit}><ActionNotice {...action} /><div className="owner-grid">{fields.map(field => <SettingsField field={field} key={field.key} value={values[field.key]} disabled={action.busy} onChange={value => setValues(current => ({ ...current, [field.key]: value }))} />)}</div>
        <div className="owner-actions"><button type="button" className="admin-button" disabled={action.busy} onClick={() => setValues(Object.fromEntries(fields.map(field => [field.key, String(settings[field.key] ?? "")])))}>Reset</button><button className="btn btn-primary" disabled={action.busy}>{action.busy ? "Saving…" : "Save Changes"}</button></div>
    </form>{section === "Payment Settings" && <OwnerPaymentAccounts />}</>;
}

function SettingsContent({ initial }: { initial: Record<string, unknown> }) {
    const [settings, setSettings] = useState(initial);
    const [query] = useSearchParams();
    const section = settingsSections.find(item => item === query.get("section")) ?? "Reservation Settings";
    return <div className="owner-settings-stack">{settingsSections.map(item => <details key={item} open={section === item}>
        <summary><span><Icon name={sectionDescriptions[item][0]} /><b>{item}</b><small>{sectionDescriptions[item][1]}</small></span><Icon name="chevron" size={18} /></summary>
        <div className="owner-settings-content">
            {item === "Document Management" ? <OwnerDocuments /> : item === "Notifications" ? <><p>Review operational notifications and send or schedule guest messages through the shared Notifications page.</p><Link to="/owner/notifications" className="btn btn-primary">Open Notifications</Link><p className="owner-help">Email transport credentials and scheduling workers are configured on the server.</p></>
                : <SectionForm section={item} settings={settings} onSaved={setSettings} />}
        </div>
    </details>)}</div>;
}

export default function OwnerSettingsPage() {
    return <OwnerPage title="System Settings" copy="Configure resort information, reservation rules, content, and documents."><AdminResource load={OwnerApi.settings} showRefresh={false}>{data => <SettingsContent initial={data.settings} />}</AdminResource></OwnerPage>;
}
