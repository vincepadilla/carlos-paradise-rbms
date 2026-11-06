import { useAdminSession } from "../../auth/RequireAdmin";
import CalendarDialog from "./CalendarDialog";

export default function OcularVisitDialog({ date, onClose }: { date: string; onClose: () => void }) {
    const { user } = useAdminSession();
    return <CalendarDialog title="Schedule Ocular Visit" eyebrow="Onsite Inspection · Form Preview" className="ocular-modal" onClose={onClose}>
        <p>Ocular visits are separate from overnight reservations and do not require a deposit or enter the reservation queue.</p>
        <p className="form-notice" role="note">Ocular scheduling is not available yet. This form is a preview; nothing entered here will be saved.</p>
        <form onSubmit={event => event.preventDefault()}>
            <div className="form-grid">
                <label className="field"><span>Guest Name</span><input name="ocular-guest" autoComplete="off" /></label>
                <label className="field"><span>Contact Details</span><input name="ocular-contact" /></label>
                <label className="field"><span>Visit Date</span><input type="date" defaultValue={date} /></label>
                <label className="field"><span>Visit Status</span><select defaultValue="Pending Review"><option>Pending Review</option><option>Approved</option><option>Cancelled</option></select></label>
                <label className="field"><span>Start Time</span><input type="time" defaultValue="10:00" /></label>
                <label className="field"><span>End Time</span><input type="time" defaultValue="11:00" /></label>
                <label className="field"><span>Inquiry Source</span><select defaultValue=""><option value="">-Select option-</option>{["Facebook Messenger", "TikTok", "Instagram", "WhatsApp", "Phone Call"].map(source => <option key={source}>{source}</option>)}</select></label>
                <div className="readonly-creator"><span>Created By</span><b>{user.name} · Admin</b></div>
            </div>
            <label className="field"><span>Notes</span><textarea placeholder="Visit purpose or preparation notes" /></label>
            <div className="button-row"><button type="submit" className="btn btn-primary" disabled>Schedule Visit — unavailable</button><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
        </form>
    </CalendarDialog>;
}
