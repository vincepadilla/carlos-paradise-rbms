import { useRef, useState, type FormEvent } from 'react';
import { AdminApi } from '../../../services/AdminApi';
import { ReservationApiError } from '../../../services/ReservationApi';
import type { OcularVisitInput } from '../../../types/calendar';
import { manilaDate } from '../../../utils/adminCalendar';
import { useAdminSession } from '../../auth/RequireAdmin';
import CalendarDialog from './CalendarDialog';

export default function OcularVisitDialog({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: (date: string) => void }) {
 const session=useAdminSession(), lock=useRef(false), [error,setError]=useState(''), [busy,setBusy]=useState(false), today=manilaDate();
 async function save(input:OcularVisitInput){
  try{await AdminApi.createOcularVisit(input);onSaved(input.visit_date)}
  catch(c){
   if(c instanceof ReservationApiError&&c.status===401)session.clear();
   if(c instanceof ReservationApiError&&c.status===403)session.revalidate();
   setError(c instanceof Error?c.message:'The ocular visit could not be saved.');
  }
  finally{lock.current=false;setBusy(false)}
 }
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault(); if(lock.current)return; lock.current=true;setBusy(true);setError('');
  const f=new FormData(e.currentTarget),v=(n:string)=>String(f.get(n)??'');
  const input:OcularVisitInput={guest_name:v('guest_name'),contact_details:v('contact_details'),visit_date:v('visit_date'),status:v('status') as OcularVisitInput['status'],start_time:v('start_time'),end_time:v('end_time'),inquiry_source:v('inquiry_source'),notes:v('notes')};
  await save(input);
 }
 return <CalendarDialog title='Schedule Ocular Visit' eyebrow='Onsite Inspection' className='ocular-modal' busy={busy} onClose={onClose}>
  <p>Ocular visits are separate from overnight reservations and do not require a deposit or enter the reservation queue.</p>
  <form onSubmit={submit}><fieldset disabled={busy}><div className='form-grid'>
   <label className='field'><span>Guest Name</span><input name='guest_name' required maxLength={255}/></label>
   <label className='field'><span>Contact Details</span><input name='contact_details' required maxLength={255}/></label>
   <label className='field'><span>Visit Date</span><input name='visit_date' type='date' required min={today} defaultValue={date<today?today:date}/></label>
   <label className='field'><span>Visit Status</span><select name='status'><option value='pending_review'>Pending Review</option><option value='approved'>Approved</option><option value='cancelled'>Cancelled</option></select></label>
   <label className='field'><span>Start Time</span><input name='start_time' type='time' required defaultValue='10:00'/></label>
   <label className='field'><span>End Time</span><input name='end_time' type='time' required defaultValue='11:00'/></label>
   <label className='field'><span>Inquiry Source</span><select name='inquiry_source'><option value=''>Select option</option>{['Facebook Messenger','TikTok','Instagram','WhatsApp','Phone Call'].map(x=><option key={x}>{x}</option>)}</select></label>
   <div className='readonly-creator'><span>Created By</span><b>{session.user.name} - Admin</b></div>
  </div><label className='field'><span>Notes</span><textarea name='notes' maxLength={4200}/></label>
  {error&&<p role='alert' className='form-error'>{error}</p>}<div className='button-row'><button className='btn btn-primary'>{busy?'Scheduling...':'Schedule Visit'}</button><button type='button' className='btn btn-ghost' onClick={onClose}>Cancel</button></div>
  </fieldset></form>
 </CalendarDialog>;
}
