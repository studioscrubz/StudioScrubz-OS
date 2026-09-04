"use client";

import { useEffect, useMemo, useState } from "react";
import { getEmployees } from "@/lib/services/employees";
import { createUserProfile, getUserProfiles, setUserActive, updateUserProfile } from "@/lib/services/users";
import { USER_ROLES, type UserProfile, type UserProfileInput, type UserRole } from "@/types/auth";
import { employeeName, type Employee } from "@/types/employee";

const empty: UserProfileInput = { auth_user_id: "", email: "", display_name: "", role: "Administrator", employee_id: null, is_active: true };

export function UserManagementPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<UserRole | "All">("All");
  const [status, setStatus] = useState<"All" | "Active" | "Inactive">("All");
  const [editing, setEditing] = useState<UserProfile | "new" | null>(null);
  const [viewing, setViewing] = useState<UserProfile | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const [profiles, employeeRows] = await Promise.all([getUserProfiles(), getEmployees()]);
    setUsers(profiles); setEmployees(employeeRows);
  }
  useEffect(() => { let current = true; void Promise.all([getUserProfiles(), getEmployees()]).then(([profiles, employeeRows]) => { if (current) { setUsers(profiles); setEmployees(employeeRows); } }).catch((cause: unknown) => { console.error("User management load failed", cause); if (current) setError(message(cause)); }).finally(() => { if (current) setLoading(false); }); return () => { current = false; }; }, []);

  const visible = useMemo(() => users.filter((user) => {
    const haystack = `${user.display_name ?? ""} ${user.email ?? ""}`.toLowerCase();
    return (!search || haystack.includes(search.toLowerCase())) && (role === "All" || user.role === role) && (status === "All" || (status === "Active") === user.is_active);
  }), [role, search, status, users]);

  async function toggle(user: UserProfile) {
    if (user.is_active && user.role === "Master Admin" && users.filter((candidate) => candidate.is_active && candidate.role === "Master Admin").length <= 1) {
      setError("At least one active Master Admin is required."); return;
    }
    setBusy(user.id); setError(null);
    try { await setUserActive(user.id, !user.is_active); await load(); setNotice(user.is_active ? "User access deactivated." : "User access reactivated."); }
    catch (cause) { console.error("User status update failed", cause); setError(message(cause)); }
    finally { setBusy(null); }
  }

  return <>
    <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-7">
      <div><p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">System administration</p><h1 className="mt-2 text-3xl font-extrabold text-[#143d1a]">User Management</h1><p className="mt-3 text-neutral-600">Manage StudioScrubz OS access, roles, and account status.</p></div>
      <button className={primary} onClick={() => setEditing("new")}>+ Add User Access</button>
    </header>
    <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Create the user in Supabase Authentication first, then enter the Auth User ID here. StudioScrubz never stores or displays passwords.</p>
    {notice && <Alert text={notice} good />}{error && <Alert text={error} />}
    <section className="mt-6 grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-3">
      <input className={input} placeholder="Search name or email" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select className={input} value={role} onChange={(event) => setRole(event.target.value as UserRole | "All")}><option>All</option>{USER_ROLES.map((value) => <option key={value}>{value}</option>)}</select>
      <select className={input} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option>All</option><option>Active</option><option>Inactive</option></select>
    </section>
    {loading ? <div className="mt-6 h-64 animate-pulse rounded-2xl bg-neutral-200" /> : <section className="mt-6 overflow-hidden rounded-2xl border bg-white"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[#edf4ec] text-[#143d1a]"><tr>{["Display Name", "Email", "Role", "Status", "Created", "Actions"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{visible.map((user) => <tr key={user.id} className="border-t"><td className="px-4 py-3 font-bold">{user.display_name || "—"}</td><td className="px-4 py-3">{user.email || "—"}</td><td className="px-4 py-3">{user.role}</td><td className="px-4 py-3"><Badge active={user.is_active} /></td><td className="px-4 py-3">{new Date(user.created_at).toLocaleDateString()}</td><td className="px-4 py-3"><div className="flex gap-2"><button className={small} onClick={() => setViewing(user)}>View</button><button className={small} onClick={() => setEditing(user)}>Edit Access</button><button disabled={busy === user.id} className={small} onClick={() => void toggle(user)}>{user.is_active ? "Deactivate" : "Reactivate"}</button></div></td></tr>)}</tbody></table></div>{!visible.length && <p className="p-10 text-center text-neutral-500">No user profiles match these filters.</p>}</section>}
    {editing && <UserForm user={editing === "new" ? null : editing} employees={employees} activeMasterAdmins={users.filter((candidate) => candidate.is_active && candidate.role === "Master Admin").length} close={() => setEditing(null)} saved={async () => { setEditing(null); await load(); setNotice("User access saved."); }} />}
    {viewing && <UserDetail user={viewing} employee={employees.find((employee) => employee.id === viewing.employee_id)} close={() => setViewing(null)} />}
  </>;
}

function UserForm({ user, employees, activeMasterAdmins, close, saved }: { user: UserProfile | null; employees: Employee[]; activeMasterAdmins: number; close: () => void; saved: () => Promise<void> }) {
  const [form, setForm] = useState<UserProfileInput>(user ? { auth_user_id: user.id, email: user.email ?? "", display_name: user.display_name ?? "", role: user.role, employee_id: user.employee_id, is_active: user.is_active } : empty);
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
async function submit() { if (!user && (!form.auth_user_id.trim() || !form.email.trim())) return setError("Auth User ID and email are required."); if (!form.display_name.trim()) return setError("Display Name is required."); if ((form.role === "Crew Lead" || form.role === "Scrub Technician") && !form.employee_id) return setError("Linked Employee is required for Crew Lead and Scrub Technician users."); if (user?.role === "Master Admin" && user.is_active && activeMasterAdmins <= 1 && (form.role !== "Master Admin" || !form.is_active)) return setError("At least one active Master Admin is required."); setSaving(true); setError(null); try { if (user) await updateUserProfile(user.id, form); else await createUserProfile(form); await saved(); } catch (cause) { console.error("User profile save failed", cause); setError(message(cause)); setSaving(false); } }
  return <Modal title={user ? "Edit User Access" : "Add User Access"} close={close}><div className="grid gap-4 sm:grid-cols-2">{!user && <><Field label="Auth User ID" value={form.auth_user_id} set={(value) => setForm({ ...form, auth_user_id: value })} /><Field label="Email" type="email" value={form.email} set={(value) => setForm({ ...form, email: value })} /></>}<Field label="Display Name" value={form.display_name} set={(value) => setForm({ ...form, display_name: value })} /><label className="text-sm font-bold">Role<select className={`${input} mt-2`} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}>{USER_ROLES.map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-sm font-bold">Linked Employee<select className={`${input} mt-2`} value={form.employee_id ?? ""} onChange={(event) => setForm({ ...form, employee_id: event.target.value || null })}><option value="">Not linked</option>{employees.filter((employee) => !employee.archived_at).map((employee) => <option key={employee.id} value={employee.id}>{employeeName(employee)} — {employee.department}</option>)}</select></label><label className="flex items-center gap-3 self-end rounded-lg border p-3 text-sm font-bold"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />Active</label></div>{error && <Alert text={error} />}<div className="mt-5 flex justify-end gap-2"><button className={small} onClick={close}>Cancel</button><button disabled={saving} className={primary} onClick={() => void submit()}>{saving ? "Saving…" : "Save Access"}</button></div></Modal>;
}

function UserDetail({ user, employee, close }: { user: UserProfile; employee?: Employee; close: () => void }) { return <Modal title={user.display_name || user.email || "User Access"} close={close}><dl className="space-y-3">{[["Email", user.email || "—"], ["Role", user.role], ["Status", user.is_active ? "Active" : "Inactive"], ["Linked Employee", employee ? `${employeeName(employee)} (${employee.employee_number})` : "Not linked"], ["Created", new Date(user.created_at).toLocaleString()]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 border-b pb-3 text-sm"><dt className="text-neutral-500">{label}</dt><dd className="font-bold text-right">{value}</dd></div>)}</dl></Modal>; }
function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-[#07190a]/70 p-5"><section className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6"><button className="float-right text-xl" onClick={close}>×</button><h2 className="mb-6 text-xl font-extrabold text-[#143d1a]">{title}</h2>{children}</section></div>; }
function Field({ label, value, set, type = "text" }: { label: string; value: string; set: (value: string) => void; type?: string }) { return <label className="text-sm font-bold">{label}<input className={`${input} mt-2`} type={type} value={value} onChange={(event) => set(event.target.value)} /></label>; }
function Badge({ active }: { active: boolean }) { return <span className={`rounded-full px-2 py-1 text-xs font-bold ${active ? "bg-green-100 text-green-800" : "bg-neutral-200 text-neutral-700"}`}>{active ? "Active" : "Inactive"}</span>; }
function Alert({ text, good }: { text: string; good?: boolean }) { return <p role="alert" className={`mt-4 rounded-xl p-3 text-sm font-bold ${good ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{text}</p>; }
function message(cause: unknown) { return cause instanceof Error ? cause.message : "User access operation failed."; }
const input = "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#d4af37]";
const primary = "rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const small = "rounded-lg border px-3 py-2 text-xs font-bold text-[#143d1a] disabled:opacity-50";
