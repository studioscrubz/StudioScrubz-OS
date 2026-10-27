// Browser-only fixtures for the isolated component gallery.
import { createRoot } from 'react-dom/client';
import { JobModal } from '../../components/jobs/JobsPage';

const employee = (id,first_name,last_name) => ({id,first_name,last_name,preferred_name:null});
const lead=employee('lead','Crystal','Garcia'),member=employee('member','Kris','Greer');
const crew={id:'crew',crew_name:'Crew B',crew_lead_id:'lead',crew_lead:lead,members:[{employee_id:'lead',employee:lead},{employee_id:'member',employee:member}]};
const job={id:'job',job_number:'JOB-TEST',client_name:'Manage Job test client',property_name:'Test property',property_id:'property',status:new URLSearchParams(location.search).get('active')?'In Progress':'Crew Assigned',assigned_crew_id:'crew',assigned_crew_name:'Crew B',crew_lead_name:'Crystal Garcia',assigned_employee_id:null,assigned_team:['Crystal Garcia','Kris Greer'],scheduled_date:'2026-10-27',start_time:'22:00:00',estimated_duration:3,service_name:'Cleaning',frequency:'One Time',division:'Commercial',price:300,labor_hours:3,recommended_crew_size:2,scope:[],internal_notes:'Bring entry key',access_instructions:null,financials_available:false,operational_started_at:new URLSearchParams(location.search).get('active')?new Date(Date.now()-3_600_000).toISOString():null,operational_ended_at:null};
const calls=[];
let photos=[];
let gps={configured:false,radiusMeters:null,lastCheck:null,employeeChecks:[],exceptions:[]};
window.fixture={calls,call(name,...args){calls.push({name,args});switch(name){
case 'getActiveCrews':return Promise.resolve([crew]);
case 'getEligibleJobTechs':return Promise.resolve([{employee_id:'lead',display_name:'Crystal Garcia',operational_role:'Crew Lead'}]);
case 'jobWorkerTarget':return {kind:'crew',crewId:'crew'};
case 'getCurrentJobClockState':return Promise.resolve({clockedIn:false,activeWorkerCount:0});
case 'getOperationalPhotos':return Promise.resolve([...photos]);
case 'createPhotoSignedUrls':return Promise.resolve(args[0].map(p=>({...p,signedUrl:null})));
case 'uploadOperationalPhoto':photos.push({id:'photo',category:args[0].category,caption:null,customerVisible:false,originalFilename:'finished.png',mimeType:'image/png',storagePath:'jobs/job/after/photo.png'});return Promise.resolve();
case 'deleteOperationalPhoto':photos=[];return Promise.resolve([]);
case 'updateOperationalPhotoVisibility':photos=photos.map(p=>({...p,customerVisible:args[4]}));return Promise.resolve([...photos]);
case 'defaultOperationalPhotoCustomerVisibility':return false;
case 'validateOperationalPhoto':return;
case 'getJobsiteGpsSummary':return Promise.resolve({...gps});
case 'getCurrentPosition':return Promise.resolve({latitude:34,longitude:-118,accuracy:5});
case 'registerJobPropertyGpsByCrewLead':gps={...gps,configured:true,radiusMeters:args[2]};return Promise.resolve();
case 'verifyJobsiteArrival':{const check={result:'Within Radius',checkedAt:new Date().toISOString(),distanceMeters:4,accuracyMeters:5};gps={...gps,lastCheck:check,employeeChecks:[{...check,employeeId:'lead'}]};return Promise.resolve(check);}
case 'approveJobsiteGpsException':gps={...gps,exceptions:[{employeeId:'lead',approvedAt:new Date().toISOString()}]};return Promise.resolve();
default:return Promise.resolve([]);
}}};
const nativeFetch=window.fetch.bind(window);
let calendarStatus='Pending';
window.fetch=(input,init)=>{
 if(!String(input).startsWith('/api/integrations/google-calendar/'))return nativeFetch(input,init);
 if(init?.method==='POST')calendarStatus='Synced';
 return Promise.resolve(new Response(JSON.stringify({sync_status:calendarStatus,event_html_link:'https://calendar.google.com/calendar/event?test'}),{status:200,headers:{'Content-Type':'application/json'}}));
};
const mutate=async(fn)=>{try{await fn();}catch(e){console.error(e);}};
const readonly=new URLSearchParams(location.search).has('readonly');
createRoot(document.getElementById('root')).render(<JobModal job={job} busy={false} close={()=>{}} mutate={mutate} canEdit={!readonly} canSchedule={!readonly} canArchive={false} canComplete={!readonly} canClock={!readonly} employeeId="lead" role="Master Admin" activeCrew={crew} activeTechs={[{employee_id:'lead',display_name:'Crystal Garcia'}]} canDeletePhotos />);
