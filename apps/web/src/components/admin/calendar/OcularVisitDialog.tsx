import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AdminApi } from '../../../services/AdminApi';
import { ReservationApiError } from '../../../services/ReservationApi';
import type { OcularVisitInput } from '../../../types/calendar';
import { manilaDate } from '../../../utils/adminCalendar';
import { useAdminSession } from '../../auth/RequireAdmin';
import CalendarDialog from './CalendarDialog';

export default function OcularVisitDialog({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: (date: string) => void }) {
 const session=useAdminSession(), lock=useRef(false), [error,setError]=useState(''), [busy,setBusy]=useState(false), today=manilaDate();
 const {clear,revalidate}=session;
 const [visitDate,setVisitDate]=useState(date<today?today:date);
 const [times,setTimes]=useState({start_time:'10:00',end_time:'11:00'});
 const [slotNotice,setSlotNotice]=useState('');
 const [suggestedDate,setSuggestedDate]=useState('');
 const validDate=Boolean(visitDate)&&visitDate>=today;
 const loadingSlot=validDate&&suggestedDate!==visitDate;
 useEffect(()=>{
  const controller=new AbortController();
  if(!visitDate||visitDate<manilaDate())return;
  AdminApi.suggestedOcularSlot(visitDate,controller.signal).then(({suggested_slot})=>{
   if(controller.signal.aborted)return;
   setTimes(suggested_slot??{start_time:'10:00',end_time:'11:00'});
   setSlotNotice(suggested_slot?'Suggested available one-hour slot. You can adjust both times.':'No one-hour slot is available from 10:00 AM onward. Choose another date or adjust the times.');
   setSuggestedDate(visitDate);
  }).catch(c=>{
   if(controller.signal.aborted)return;
   if(c instanceof ReservationApiError&&c.status===401)clear();
   if(c instanceof ReservationApiError&&c.status===403)revalidate();
   setSlotNotice('Unable to suggest a slot. Enter the times; availability will be checked when saving.');
   setSuggestedDate(visitDate);
  });
  return()=>controller.abort();
 },[visitDate,clear,revalidate]);
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
  e.preventDefault(); if(lock.current||loadingSlot||suggestedDate!==visitDate)return; setError('');
  const f=new FormData(e.currentTarget),v=(n:string)=>String(f.get(n)??'');
  const input:OcularVisitInput={guest_name:v('guest_name'),contact_details:v('contact_details'),visit_date:v('visit_date'),status:v('status') as OcularVisitInput['status'],start_time:v('start_time'),end_time:v('end_time'),inquiry_source:v('inquiry_source'),notes:v('notes')};
  if(input.end_time<=input.start_time){setError('End time must be later than start time.');return}
  if(Date.parse(`${input.visit_date}T${input.start_time}:00+08:00`)<=Date.now()){setError('The ocular visit must be scheduled in the future.');return}
  lock.current=true;setBusy(true);
  await save(input);
 }
 return <CalendarDialog title='Schedule Ocular Visit' eyebrow='Onsite Inspection' className='ocular-modal' busy={busy} onClose={onClose}>
  <p>Ocular visits are separate from overnight reservations and do not require a deposit or enter the reservation queue.</p>
  <form onSubmit={submit}><fieldset disabled={busy}><div className='form-grid'>
   <label className='field'><span>Guest Name</span><input name='guest_name' required maxLength={255}/></label>
   <label className='field'><span>Contact Details</span><input name='contact_details' required maxLength={255}/></label>
   <label className='field'><span>Visit Date</span><input name='visit_date' type='date' required min={today} value={visitDate} onChange={e=>{setVisitDate(e.target.value);setSuggestedDate('');setSlotNotice('');setError('')}}/></label>
   <label className='field'><span>Visit Status</span><select name='status'><option value='pending_review'>Pending Review</option><option value='approved'>Approved</option><option value='cancelled'>Cancelled</option></select></label>
   <label className='field'><span>Start Time (Manila)</span><input name='start_time' type='time' required disabled={loadingSlot||suggestedDate!==visitDate} value={times.start_time} onChange={e=>setTimes({...times,start_time:e.target.value})}/></label>
   <label className='field'><span>End Time (Manila)</span><input name='end_time' type='time' required disabled={loadingSlot||suggestedDate!==visitDate} value={times.end_time} onChange={e=>setTimes({...times,end_time:e.target.value})}/></label>
   <label className='field'><span>Inquiry Source</span><select name='inquiry_source'><option value=''>Select option</option>{['Facebook Messenger','TikTok','Instagram','WhatsApp','Phone Call'].map(x=><option key={x}>{x}</option>)}</select></label>
   <div className='readonly-creator'><span>Created By</span><b>{session.user.name} - {session.user.role === 'owner' ? 'Owner' : 'Admin'}</b></div>
  </div><label className='field'><span>Notes</span><textarea name='notes' maxLength={4200}/></label>
  <p role='status'>{!validDate?'Choose a valid visit date.':loadingSlot?'Finding an available time...':slotNotice}</p>
  {error&&<p role='alert' className='form-error'>{error}</p>}<div className='button-row'><button className='btn btn-primary' disabled={loadingSlot||suggestedDate!==visitDate}>{busy?'Scheduling...':'Schedule Visit'}</button><button type='button' className='btn btn-ghost' onClick={onClose}>Cancel</button></div>
  </fieldset></form>
 </CalendarDialog>;
}
