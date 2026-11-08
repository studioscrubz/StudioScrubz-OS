"use client";import{useEffect,useState}from"react";import{calculateEmployeePerformance,finalizeEmployeePerformance,getEmployeePerformanceReviews,performanceBand}from"@/lib/services/employeePerformance";import{getEmployees}from"@/lib/services/employees";import{employeeName,type Employee}from"@/types/employee";import type{EmployeePerformanceReview,PerformanceComponent}from"@/types/employeePerformance";import{PerformanceWorkflow}from"@/components/jobs/EmployeePerformanceWorkflow";
const field="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm",button="rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50";
export function EmployeePerformanceManagement({ today }: { today: string }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [days, setDays] = useState<30 | 90>(30);
  const [selectedEnd, setEnd] = useState<string | null>(null);
  const [review, setReview] = useState<EmployeePerformanceReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmNoCallbacks, setConfirmNoCallbacks] = useState(false);
  const end = selectedEnd ?? today;

  useEffect(() => {
    void getEmployees()
      .then(rows => setEmployees(rows.filter(employee => employee.employment_status === "Active" && !employee.archived_at)))
      .catch(() => setError("Employees could not be loaded."));
  }, []);

  function resetReview() {
    setReview(null);
    setError(null);
    setConfirmNoCallbacks(false);
  }

  async function calculate() {
    setBusy(true);
    setError(null);
    try {
      setReview(await calculateEmployeePerformance(employeeId, days, end, confirmNoCallbacks));
    } catch (cause) {
      setError(msg(cause));
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      setReview(await finalizeEmployeePerformance(review.id));
    } catch (cause) {
      setError(msg(cause));
    } finally {
      setBusy(false);
    }
  }

  return <section className="mt-6 rounded-2xl border bg-white p-4">
    <h2 className="font-extrabold text-[#143d1a]">Employee Performance Review</h2>
    <p className="mt-1 text-sm text-neutral-600">Evidence-based decision support. Missing evidence is never scored as zero.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <select className={field} value={employeeId} aria-label="Employee" disabled={busy} onChange={event => { setEmployeeId(event.target.value); resetReview(); }}>
        <option value="">Select employee</option>
        {employees.map(employee => <option key={employee.id} value={employee.id}>{employeeName(employee)}</option>)}
      </select>
      <select className={field} value={days} aria-label="Review length" disabled={busy} onChange={event => { setDays(Number(event.target.value) as 30 | 90); resetReview(); }}>
        <option value={30}>30 days</option>
        <option value={90}>90 days</option>
      </select>
      <input className={field} type="date" aria-label="Review end date" value={end} max={today} disabled={busy} onChange={event => { setEnd(event.target.value); resetReview(); }}/>
      <button disabled={busy || !employeeId || !end || end > today} className={button} onClick={() => void calculate()}>Calculate new draft</button>
    </div>
    <label className="mt-3 flex items-start gap-2 text-sm text-neutral-700">
      <input className="mt-1" type="checkbox" checked={confirmNoCallbacks} disabled={busy || !employeeId} onChange={event => setConfirmNoCallbacks(event.target.checked)}/>
      I reviewed callbacks for this employee and date range and confirmed there were no attributable callbacks.
    </label>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {review && <>
      <Review review={review} employeeView={false} action={review.status === "Draft"
        ? <button disabled={busy} className={button} onClick={() => void finalize()}>Finalize immutable review</button>
        : null}/>
      {review.status === "Draft" && <ReviewTarget review={review}/>}
    </>}
    {employeeId && <PerformanceWorkflow employeeId={employeeId} management refresh={review?.id}/>}
  </section>;
}
export function MyPerformanceReviews(){const[reviews,setReviews]=useState<EmployeePerformanceReview[]>([]);useEffect(()=>{void getEmployeePerformanceReviews().then(rows=>setReviews(rows.filter(review=>review.status==="Finalized"))).catch(()=>setReviews([]))},[]);if(!reviews.length)return null;return <section className="mt-6 rounded-2xl border bg-white p-4"><h2 className="font-extrabold text-[#143d1a]">My Performance Reviews</h2><p className="mt-1 text-xs text-neutral-600">Only your finalized reviews are shown. No rankings or compensation information are included.</p><Review review={reviews[0]} employeeView/><PerformanceWorkflow management={false}/></section>}
const qualityChecks = [
  ["inspection", "Inspection", 15],
  ["callbacks", "Callbacks", 10],
  ["scopeCompletion", "Scope Completion", 5],
  ["customerFeedback", "Customer Feedback", 5],
] as const;

function Review({review,employeeView,action}:{review:EmployeePerformanceReview;employeeView:boolean;action?:React.ReactNode}) {
  const scores = review.component_scores;
  return <div className="mt-4 rounded-xl bg-neutral-50 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <b>{review.review_period_days}-day review · {review.period_start} – {review.period_end}</b>
        <p className="text-sm">{review.overall_score === null ? "Overall score unavailable — insufficient evidence" : `Overall Score: ${Number(review.overall_score).toFixed(2)} / 100`}</p>
        {review.overall_score === null && <p className="text-sm">
          {review.measured_max_points > 0
            ? `Measured subtotal: ${Number(review.measured_points).toFixed(2)} / ${review.measured_max_points} available points. Evidence covers ${review.measured_max_points} of 100 possible points.`
            : "No categories have scored evidence in this review."}
        </p>}
        <p className="text-xs text-neutral-500">{review.classification} · {review.calculation_version} revision {review.revision} · {review.status}</p>
      </div>
      {!employeeView && action}
    </div>
    {review.quality_gate_triggered && <p className="mt-3 rounded bg-amber-50 p-2 text-sm font-bold text-amber-800">Quality Review Required: serious explicitly attributed quality evidence is present. Component scores remain unchanged.</p>}
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      <Component label="Quality" x={scores.quality}/>
      <Component label="Labor Efficiency" x={scores.laborEfficiency}/>
      <Component label="Attendance" x={scores.attendance}/>
      <Component label="Compliance" x={scores.compliance}/>
      <Component label="Teamwork" x={scores.teamwork}/>
    </div>
    <details className="mt-3 rounded-lg border bg-white p-3 text-sm">
      <summary className="cursor-pointer font-bold">Quality breakdown · 35 possible points</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {qualityChecks.map(([key,label,maximum]) => {
          const check = scores.quality.evidence?.[key];
          return check
            ? <Component key={key} label={label} x={check}/>
            : <p key={key}>{label} · up to {maximum} points · No evidence breakdown in this snapshot</p>;
        })}
      </div>
    </details>
    {!employeeView && review.overall_score === null && <p className="mt-3 text-sm text-neutral-700">
      To add evidence, open a completed job under <b>Job Performance → Quality</b>. Finalize an inspection or scope result, or record customer feedback or a callback, then attribute it to the employee. Use the same job panel to record employee-owned compliance and documented teamwork. Calculate a new draft after recording the evidence.
    </p>}
  </div>;
}
function ReviewTarget({review}:{review:EmployeePerformanceReview}){const[now]=useState(()=>Date.now()),overdue=now>new Date(review.review_due_at).getTime();return <p className={`mt-2 rounded-lg border p-3 text-sm ${overdue?"border-amber-300 bg-amber-50 text-amber-900":"border-blue-200 bg-blue-50 text-blue-900"}`}><b>{overdue?"Review Overdue":"Review Pending"}</b> · 72-hour management target: {new Date(review.review_due_at).toLocaleString()}. The review remains Draft until management finalizes it.{review.overall_score!==null&&<> Band: {performanceBand(review.overall_score)}.</>}</p>}
function Component({label,x}:{label:string;x:PerformanceComponent}){return <div className="rounded-lg border bg-white p-3"><b className="text-sm">{label}</b><p className="text-lg font-extrabold text-[#143d1a]">{x.points===null?"N/A":`${Number(x.points).toFixed(2)} / ${x.maximum}`}</p><p className="text-xs font-bold text-neutral-500">{x.evidenceState} · {x.evidenceCount} {x.evidenceCount === 1 ? "record" : "records"}</p><p className="mt-1 text-xs text-neutral-600">{x.explanation}</p></div>}function msg(cause: unknown) {
  if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string") {
    return cause.message;
  }
  return "Performance review operation failed.";
}
