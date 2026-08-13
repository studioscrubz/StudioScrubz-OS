"use client";
import { useEffect, useMemo, useState } from "react";
import {
  archiveVehicle,
  createVehicle,
  getVehicles,
  updateVehicle,
} from "@/lib/services/vehicles";
import {
  archiveMileageEntry,
  calculateMileage,
  createMileageEntry,
  getMileageEntries,
  getMileageSummary,
  updateMileageEntry,
  voidMileageEntry,
} from "@/lib/services/mileage";
import { getEmployees } from "@/lib/services/employees";
import { getCrews } from "@/lib/services/crews";
import { getJobs } from "@/lib/services/jobs";
import { getClients } from "@/lib/services/clients";
import { getProperties } from "@/lib/services/properties";
import {
  VEHICLE_OWNERSHIP_TYPES,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
  vehicleLabel,
  type VehicleInput,
  type VehicleWithRelations,
} from "@/types/vehicle";
import {
  MILEAGE_STATUSES,
  type MileageInput,
  type MileageWithRelations,
} from "@/types/mileage";
import type { Employee } from "@/types/employee";
import type { CrewWithRelations } from "@/types/crew";
import type { JobWithRelations } from "@/types/job";
import type { Client } from "@/types/client";
import type { PropertyWithClient } from "@/types/property";

export function VehiclesPage() {
  const [vehicles, setVehicles] = useState<VehicleWithRelations[]>([]),
    [mileage, setMileage] = useState<MileageWithRelations[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [vehicleModal, setVehicleModal] = useState<
      VehicleWithRelations | null | "new"
    >(null),
    [mileageModal, setMileageModal] = useState<
      MileageWithRelations | null | "new"
    >(null),
    [detail, setDetail] = useState<VehicleWithRelations | null>(null),
    [search, setSearch] = useState(""),
    [vehicleFilter, setVehicleFilter] = useState("All"),
    [employeeFilter, setEmployeeFilter] = useState("All"),
    [crewFilter, setCrewFilter] = useState("All"),
    [businessFilter, setBusinessFilter] = useState("All"),
    [statusFilter, setStatusFilter] = useState("All"),
    [dateFilter, setDateFilter] = useState("This Month"),
    [sort, setSort] = useState("Newest");
  async function load() {
    const [v, m] = await Promise.all([getVehicles(), getMileageEntries()]);
    setVehicles(v);
    setMileage(m);
  }
  useEffect(() => {
    void Promise.all([getVehicles(), getMileageEntries()])
      .then(([v, m]) => { setVehicles(v); setMileage(m); })
      .catch((x) => setError(msg(x)))
      .finally(() => setLoading(false));
  }, []);
  const activeMileage = mileage.filter(
      (x) => x.status === "Active" && !x.archived_at,
    ),
    summary = getMileageSummary(mileage),
    vehicleCards = [
      [
        "Active Vehicles",
        vehicles.filter((x) => x.status === "Active" && !x.archived_at).length,
      ],
      [
        "Vehicles In Maintenance",
        vehicles.filter((x) => x.status === "Maintenance" && !x.archived_at)
          .length,
      ],
      [
        "Company Vehicles",
        vehicles.filter(
          (x) => x.ownership_type === "Company Owned" && !x.archived_at,
        ).length,
      ],
      [
        "Personal Vehicles",
        vehicles.filter(
          (x) => x.ownership_type === "Personal" && !x.archived_at,
        ).length,
      ],
      ["Mileage This Month", `${summary.thisMonth.toFixed(1)} mi`],
    ] as const;
  const filtered = useMemo(
    () =>
      mileage
        .filter((x) => {
          const hay = [
            x.mileage_number,
            vehicleLabel(x.vehicle),
            x.trip_purpose,
            x.job?.job_number,
            x.client?.company_name,
            x.client?.first_name,
            x.start_location,
            x.end_location,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return (
            (!search || hay.includes(search.toLowerCase())) &&
            (vehicleFilter === "All" || x.vehicle_id === vehicleFilter) &&
            (employeeFilter === "All" || x.employee_id === employeeFilter) &&
            (crewFilter === "All" || x.crew_id === crewFilter) &&
            (businessFilter === "All" ||
              x.business_use === (businessFilter === "Business")) &&
            (statusFilter === "All" || x.status === statusFilter) &&
            dateMatch(x.trip_date, dateFilter)
          );
        })
        .sort((a, b) => sortMileage(a, b, sort)),
    [
      businessFilter,
      crewFilter,
      dateFilter,
      employeeFilter,
      mileage,
      search,
      sort,
      statusFilter,
      vehicleFilter,
    ],
  );
  async function act(fn: () => Promise<unknown>, text: string) {
    try {
      await fn();
      await load();
      setNotice(text);
      setError(null);
    } catch (x) {
      setError(msg(x));
    }
  }
  return (
    <>
      <header className="border-b pb-7">
        <h1 className="text-3xl font-extrabold text-[#143d1a]">Vehicles</h1>
        <p className="mt-3 text-neutral-600">
          Manage StudioScrubz vehicles, assignments, and mileage records.
        </p>
        <div className="mt-5 flex gap-2">
          <button className={primary} onClick={() => setVehicleModal("new")}>
            Add Vehicle
          </button>
          <button className={secondary} onClick={() => setMileageModal("new")}>
            Add Mileage
          </button>
        </div>
      </header>
      {error && <Alert text={error} />} {notice && <Alert text={notice} good />}
      <section className="mt-7 grid grid-cols-2 gap-4 xl:grid-cols-5">
        {vehicleCards.map(([l, v]) => (
          <Card key={l} l={l} v={loading ? "—" : String(v)} />
        ))}
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-extrabold text-[#143d1a]">Fleet</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {vehicles.map((v) => (
            <article key={v.id} className="rounded-2xl border bg-white p-5">
              <button className="w-full text-left" onClick={() => setDetail(v)}>
                <b className="text-[#143d1a]">
                  {v.vehicle_number} · {vehicleLabel(v)}
                </b>
                <p className="mt-1 text-sm text-neutral-500">
                  {v.vehicle_type || "Type not set"} ·{" "}
                  {v.ownership_type || "Ownership not set"}
                </p>
                <p className="mt-2 text-sm">
                  {v.status} · {v.license_plate || "No plate"}
                </p>
                <p className="text-xs text-neutral-500">
                  Employee:{" "}
                  {v.assigned_employee
                    ? `${v.assigned_employee.first_name} ${v.assigned_employee.last_name}`
                    : "Unassigned"}{" "}
                  · Crew: {v.assigned_crew?.crew_name || "Unassigned"}
                </p>
              </button>
              {v.status !== "Archived" && (
                <div className="mt-3 flex gap-2">
                  <button
                    className={secondary}
                    onClick={() => setVehicleModal(v)}
                  >
                    Edit
                  </button>
                  <button
                    className={secondary}
                    onClick={() =>
                      void act(() => archiveVehicle(v.id), "Vehicle archived.")
                    }
                  >
                    Archive
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
        {!vehicles.length && !loading && (
          <Empty text="No vehicles have been added." />
        )}
      </section>
      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-[#143d1a]">Mileage</h2>
            <p className="text-sm text-neutral-500">
              Potential mileage deduction is informational and is not subtracted
              from operating profit.
            </p>
          </div>
          <div className="flex gap-2">
            <button className={secondary} onClick={() => exportCsv(filtered)}>
              Export CSV
            </button>
            <button className={secondary} onClick={() => window.print()}>
              Print Mileage Report
            </button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-6">
          {([ 
            ["Miles This Month", summary.thisMonth],
            ["Miles This Year", summary.thisYear],
            ["Business Miles", summary.businessMiles],
            ["Personal Miles", summary.personalMiles],
            ["Potential Mileage Deduction", money(summary.deductibleAmount)],
            ["Average / Trip", summary.averageMiles],
          ] satisfies Array<[string, string | number]>).map(([l, v]) => (
            <Card
              key={l}
              l={l}
              v={
                typeof v === "number" && !l.includes("Deduction")
                  ? `${v.toFixed(1)} mi`
                  : String(v)
              }
            />
          ))}
        </div>
        <div className="mt-5 grid gap-2 rounded-2xl border bg-white p-4 md:grid-cols-3 xl:grid-cols-8">
          <input
            className={input}
            placeholder="Search mileage"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            v={vehicleFilter}
            set={setVehicleFilter}
            options={[
              ["All", "All Vehicles"],
              ...vehicles.map((x) => [x.id, vehicleLabel(x)]),
            ]}
          />
          <Select
            v={employeeFilter}
            set={setEmployeeFilter}
            options={[
              ["All", "All Employees"],
              ...unique(
                mileage
                  .map((x) => x.employee)
                  .filter(Boolean)
                  .map((x) => [x!.id, `${x!.first_name} ${x!.last_name}`]),
              ),
            ]}
          />
          <Select
            v={crewFilter}
            set={setCrewFilter}
            options={[
              ["All", "All Crews"],
              ...unique(
                mileage
                  .map((x) => x.crew)
                  .filter(Boolean)
                  .map((x) => [x!.id, x!.crew_name]),
              ),
            ]}
          />
          <Select
            v={businessFilter}
            set={setBusinessFilter}
            options={["All", "Business", "Personal"].map((x) => [x, x])}
          />
          <Select
            v={statusFilter}
            set={setStatusFilter}
            options={["All", ...MILEAGE_STATUSES].map((x) => [x, x])}
          />
          <Select
            v={dateFilter}
            set={setDateFilter}
            options={["This Month", "Last Month", "This Year", "All Time"].map(
              (x) => [x, x],
            )}
          />
          <Select
            v={sort}
            set={setSort}
            options={[
              "Newest",
              "Oldest",
              "Miles High to Low",
              "Miles Low to High",
              "Deduction High to Low",
              "Vehicle",
            ].map((x) => [x, x])}
          />
        </div>
        <div className="mt-5 overflow-x-auto rounded-2xl border bg-white">
          <table className="w-full min-w-[1250px] text-sm">
            <thead>
              <tr>
                {[
                  "Mileage",
                  "Date",
                  "Vehicle",
                  "Purpose / Route",
                  "Job",
                  "Employee / Crew",
                  "Miles",
                  "Rate",
                  "Potential Deduction",
                  "Status",
                  "Actions",
                ].map((x) => (
                  <th key={x} className="p-3 text-left">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((x) => (
                <tr key={x.id} className="border-t">
                  <td className="p-3 font-bold">{x.mileage_number}</td>
                  <td className="p-3">{x.trip_date}</td>
                  <td className="p-3">{vehicleLabel(x.vehicle)}</td>
                  <td className="p-3">
                    {x.trip_purpose}
                    <p className="text-xs text-neutral-500">
                      {x.start_location || "—"} → {x.end_location || "—"}
                    </p>
                  </td>
                  <td className="p-3">{x.job?.job_number || "—"}</td>
                  <td className="p-3">
                    {x.employee
                      ? `${x.employee.first_name} ${x.employee.last_name}`
                      : x.crew?.crew_name || "—"}
                  </td>
                  <td className="p-3 font-bold">{x.miles.toFixed(1)}</td>
                  <td className="p-3">
                    {x.mileage_rate === null ? "—" : money(x.mileage_rate)}
                  </td>
                  <td className="p-3">{money(x.deductible_amount)}</td>
                  <td className="p-3">{x.status}</td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      {x.status === "Active" && (
                        <>
                          <button
                            className={secondary}
                            onClick={() => setMileageModal(x)}
                          >
                            Edit
                          </button>
                          <button
                            className={secondary}
                            onClick={() =>
                              void act(
                                () => voidMileageEntry(x.id),
                                "Mileage entry voided.",
                              )
                            }
                          >
                            Void
                          </button>
                          <button
                            className={secondary}
                            onClick={() =>
                              void act(
                                () => archiveMileageEntry(x.id),
                                "Mileage entry archived.",
                              )
                            }
                          >
                            Archive
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <Empty text="No mileage records match the selected filters." />
          )}
        </div>
      </section>
      {vehicleModal && (
        <VehicleForm
          vehicle={vehicleModal === "new" ? null : vehicleModal}
          close={() => setVehicleModal(null)}
          saved={async () => {
            setVehicleModal(null);
            await load();
            setNotice("Vehicle saved.");
          }}
        />
      )}
      {mileageModal && (
        <MileageForm
          entry={mileageModal === "new" ? null : mileageModal}
          vehicles={vehicles.filter((x) => x.status !== "Archived")}
          close={() => setMileageModal(null)}
          saved={async () => {
            setMileageModal(null);
            await load();
            setNotice("Mileage entry saved.");
          }}
        />
      )}
      {detail && (
        <VehicleDetail
          vehicle={detail}
          trips={activeMileage.filter((x) => x.vehicle_id === detail.id)}
          close={() => setDetail(null)}
        />
      )}
    </>
  );
}

function VehicleForm({
  vehicle,
  close,
  saved,
}: {
  vehicle: VehicleWithRelations | null;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [v, setV] = useState<VehicleInput>(
      vehicle
        ? pickVehicle(vehicle)
        : {
            nickname: null,
            year: null,
            make: "",
            model: "",
            color: null,
            license_plate: null,
            vin: null,
            vehicle_type: "Van",
            ownership_type: "Company Owned",
            status: "Active",
            assigned_employee_id: null,
            assigned_crew_id: null,
            current_odometer: null,
            notes: null,
          },
    ),
    [employees, setEmployees] = useState<Employee[]>([]),
    [crews, setCrews] = useState<CrewWithRelations[]>([]),
    [error, setError] = useState<string | null>(null),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    void Promise.all([getEmployees(), getCrews()])
      .then(([e, c]) => {
        setEmployees(e.filter((x) => !x.archived_at));
        setCrews(c.filter((x) => !x.archived_at));
      })
      .catch((x) => setError(msg(x)));
  }, []);
  function set<K extends keyof VehicleInput>(k: K, value: VehicleInput[K]) {
    setV((x) => ({ ...x, [k]: value }));
  }
  async function submit() {
    if (!v.make.trim() || !v.model.trim())
      return setError("Make and model are required.");
    setSaving(true);
    try {
      if (vehicle) await updateVehicle(vehicle.id, v);
      else await createVehicle(v);
      await saved();
    } catch (x) {
      setError(msg(x));
      setSaving(false);
    }
  }
  return (
    <Modal
      title={vehicle ? `Edit ${vehicle.vehicle_number}` : "Add Vehicle"}
      close={close}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          l="Nickname"
          v={v.nickname ?? ""}
          set={(x) => set("nickname", x || null)}
        />
        <Field
          l="Year"
          type="number"
          v={v.year?.toString() ?? ""}
          set={(x) => set("year", x ? Number(x) : null)}
        />
        <Field l="Make" v={v.make} set={(x) => set("make", x)} />
        <Field l="Model" v={v.model} set={(x) => set("model", x)} />
        <Field
          l="Color"
          v={v.color ?? ""}
          set={(x) => set("color", x || null)}
        />
        <Field
          l="License Plate"
          v={v.license_plate ?? ""}
          set={(x) => set("license_plate", x || null)}
        />
        <Field l="VIN" v={v.vin ?? ""} set={(x) => set("vin", x || null)} />
        <LabeledSelect
          l="Vehicle Type"
          v={v.vehicle_type ?? ""}
          set={(x) => set("vehicle_type", x as VehicleInput["vehicle_type"])}
          values={VEHICLE_TYPES}
        />
        <LabeledSelect
          l="Ownership Type"
          v={v.ownership_type ?? ""}
          set={(x) =>
            set("ownership_type", x as VehicleInput["ownership_type"])
          }
          values={VEHICLE_OWNERSHIP_TYPES}
        />
        <LabeledSelect
          l="Status"
          v={v.status}
          set={(x) => set("status", x as VehicleInput["status"])}
          values={VEHICLE_STATUSES}
        />
        <Assoc
          l="Assigned Employee"
          v={v.assigned_employee_id}
          set={(x) => set("assigned_employee_id", x)}
          rows={employees.map((x) => [x.id, `${x.first_name} ${x.last_name}`])}
        />
        <Assoc
          l="Assigned Crew"
          v={v.assigned_crew_id}
          set={(x) => set("assigned_crew_id", x)}
          rows={crews.map((x) => [x.id, x.crew_name])}
        />
        <Field
          l="Current Odometer"
          type="number"
          v={v.current_odometer?.toString() ?? ""}
          set={(x) => set("current_odometer", x ? Number(x) : null)}
        />
      </div>
      <label className="mt-3 block">
        Notes
        <textarea
          className={`${input} h-24`}
          value={v.notes ?? ""}
          onChange={(e) => set("notes", e.target.value || null)}
        />
      </label>
      {error && <Alert text={error} />}
      <button
        disabled={saving}
        className={`${primary} mt-4`}
        onClick={() => void submit()}
      >
        {saving ? "Saving…" : "Save Vehicle"}
      </button>
    </Modal>
  );
}

function MileageForm({
  entry,
  vehicles,
  close,
  saved,
}: {
  entry: MileageWithRelations | null;
  vehicles: VehicleWithRelations[];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const initial = entry
    ? pickMileage(entry)
    : blankMileage(vehicles[0]?.id ?? "");
  const [v, setV] = useState<MileageInput>(initial),
    [manualMiles, setManualMiles] = useState(
      entry ? (entry.round_trip ? entry.miles / 2 : entry.miles) : 0,
    ),
    [employees, setEmployees] = useState<Employee[]>([]),
    [crews, setCrews] = useState<CrewWithRelations[]>([]),
    [jobs, setJobs] = useState<JobWithRelations[]>([]),
    [clients, setClients] = useState<Client[]>([]),
    [properties, setProperties] = useState<PropertyWithClient[]>([]),
    [error, setError] = useState<string | null>(null),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    void Promise.all([
      getEmployees(),
      getCrews(),
      getJobs(),
      getClients(),
      getProperties(),
    ])
      .then(([e, c, j, cl, p]) => {
        setEmployees(e);
        setCrews(c);
        setJobs(j);
        setClients(cl);
        setProperties(p);
      })
      .catch((x) => setError(msg(x)));
  }, []);
  function set<K extends keyof MileageInput>(k: K, value: MileageInput[K]) {
    setV((x) => ({ ...x, [k]: value }));
  }
  const calc = useMemo(() => {
    try {
      return calculateMileage({
        startOdometer: v.start_odometer,
        endOdometer: v.end_odometer,
        manualMiles,
        roundTrip: v.round_trip,
        mileageRate: v.mileage_rate,
      });
    } catch {
      return null;
    }
  }, [
    manualMiles,
    v.end_odometer,
    v.mileage_rate,
    v.round_trip,
    v.start_odometer,
  ]);
  function chooseJob(id: string | null) {
    const j = jobs.find((x) => x.id === id);
    setV((x) => ({
      ...x,
      job_id: id,
      client_id: j?.client_id ?? x.client_id,
      property_id: j?.property_id ?? x.property_id,
      crew_id: j?.assigned_crew_id ?? x.crew_id,
    }));
  }
  async function submit() {
    if (!v.vehicle_id || !v.trip_purpose.trim())
      return setError("Vehicle and trip purpose are required.");
    if (!calc) return setError("Mileage calculation is invalid.");
    setSaving(true);
    try {
      const data = { ...v, miles: manualMiles };
      if (entry) await updateMileageEntry(entry.id, data);
      else await createMileageEntry(data);
      await saved();
    } catch (x) {
      setError(msg(x));
      setSaving(false);
    }
  }
  const propertyRows = properties.filter(
    (x) => !v.client_id || x.client_id === v.client_id,
  );
  return (
    <Modal
      title={entry ? `Edit ${entry.mileage_number}` : "Add Mileage"}
      close={close}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          l="Trip Date"
          type="date"
          v={v.trip_date}
          set={(x) => set("trip_date", x)}
        />
        <Assoc
          l="Vehicle"
          required
          v={v.vehicle_id || null}
          set={(x) => set("vehicle_id", x ?? "")}
          rows={vehicles.map((x) => [
            x.id,
            `${x.vehicle_number} · ${vehicleLabel(x)}`,
          ])}
        />
        <Assoc
          l="Employee"
          v={v.employee_id}
          set={(x) => set("employee_id", x)}
          rows={employees.map((x) => [x.id, `${x.first_name} ${x.last_name}`])}
        />
        <Assoc
          l="Crew"
          v={v.crew_id}
          set={(x) => set("crew_id", x)}
          rows={crews.map((x) => [x.id, x.crew_name])}
        />
        <Assoc
          l="Job"
          v={v.job_id}
          set={chooseJob}
          rows={jobs.map((x) => [
            x.id,
            `${x.job_number} · ${x.client_name || "Client"}`,
          ])}
        />
        <Assoc
          l="Client"
          v={v.client_id}
          set={(x) => {
            set("client_id", x);
            set("property_id", null);
          }}
          rows={clients.map((x) => [
            x.id,
            x.company_name ||
              `${x.first_name ?? ""} ${x.last_name ?? ""}`.trim() ||
              "Client",
          ])}
        />
        <Assoc
          l="Property"
          v={v.property_id}
          set={(x) => set("property_id", x)}
          rows={propertyRows.map((x) => [x.id, x.property_name || x.address])}
        />
        <Field
          l="Trip Purpose"
          v={v.trip_purpose}
          set={(x) => set("trip_purpose", x)}
        />
        <Field
          l="Start Location"
          v={v.start_location ?? ""}
          set={(x) => set("start_location", x || null)}
        />
        <Field
          l="End Location"
          v={v.end_location ?? ""}
          set={(x) => set("end_location", x || null)}
        />
        <Field
          l="Start Odometer"
          type="number"
          v={v.start_odometer?.toString() ?? ""}
          set={(x) => set("start_odometer", x ? Number(x) : null)}
        />
        <Field
          l="End Odometer"
          type="number"
          v={v.end_odometer?.toString() ?? ""}
          set={(x) => set("end_odometer", x ? Number(x) : null)}
        />
        <Field
          l="Manual One-Way Miles"
          type="number"
          v={String(manualMiles)}
          set={(x) => setManualMiles(Number(x))}
        />
        <Field
          l="Mileage Rate"
          type="number"
          v={v.mileage_rate?.toString() ?? ""}
          set={(x) => set("mileage_rate", x ? Number(x) : null)}
        />
        <label>
          <input
            type="checkbox"
            checked={v.round_trip}
            onChange={(e) => set("round_trip", e.target.checked)}
          />{" "}
          Round Trip (doubles manual one-way miles)
        </label>
        <label>
          <input
            type="checkbox"
            checked={v.business_use}
            onChange={(e) => set("business_use", e.target.checked)}
          />{" "}
          Business Use
        </label>
      </div>
      <div className="mt-4 rounded-xl bg-[#edf4ec] p-4">
        <b>Calculated Miles: {calc?.miles.toFixed(2) ?? "Invalid"}</b>
        <p>
          Potential Mileage Deduction:{" "}
          {calc ? money(calc.deductibleAmount) : "—"}
        </p>
        <p className="text-xs text-neutral-500">
          Odometer readings take priority and are never doubled.
        </p>
      </div>
      <label className="mt-3 block">
        Notes
        <textarea
          className={`${input} h-24`}
          value={v.notes ?? ""}
          onChange={(e) => set("notes", e.target.value || null)}
        />
      </label>
      {error && <Alert text={error} />}
      <button
        disabled={saving}
        className={`${primary} mt-4`}
        onClick={() => void submit()}
      >
        {saving ? "Saving…" : "Save Mileage"}
      </button>
    </Modal>
  );
}

function VehicleDetail({
  vehicle,
  trips,
  close,
}: {
  vehicle: VehicleWithRelations;
  trips: MileageWithRelations[];
  close: () => void;
}) {
  return (
    <Modal
      title={`${vehicle.vehicle_number} · ${vehicleLabel(vehicle)}`}
      close={close}
    >
      <dl className="grid gap-3 sm:grid-cols-2">
        {[
          [
            "Year / Make / Model",
            `${vehicle.year ?? "—"} ${vehicle.make} ${vehicle.model}`,
          ],
          ["License Plate", vehicle.license_plate || "—"],
          ["VIN", vehicle.vin || "—"],
          ["Vehicle Type", vehicle.vehicle_type || "—"],
          ["Ownership", vehicle.ownership_type || "—"],
          ["Status", vehicle.status],
          [
            "Assigned Employee",
            vehicle.assigned_employee
              ? `${vehicle.assigned_employee.first_name} ${vehicle.assigned_employee.last_name}`
              : "—",
          ],
          ["Assigned Crew", vehicle.assigned_crew?.crew_name || "—"],
          ["Current Odometer", vehicle.current_odometer?.toString() || "—"],
          [
            "Total Business Miles",
            trips
              .filter((x) => x.business_use)
              .reduce((n, x) => n + x.miles, 0)
              .toFixed(1),
          ],
          ["Notes", vehicle.notes || "—"],
        ].map(([a, b]) => (
          <div key={a}>
            <dt className="text-xs text-neutral-500">{a}</dt>
            <dd className="font-bold">{b}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-6 font-bold">Recent Trips</h3>
      {trips.slice(0, 5).map((x) => (
        <p key={x.id} className="mt-2 border-t pt-2 text-sm">
          {x.trip_date} · {x.trip_purpose} · {x.miles.toFixed(1)} mi
        </p>
      ))}
      {!trips.length && (
        <p className="mt-2 text-sm text-neutral-500">
          No active trips for this vehicle.
        </p>
      )}
    </Modal>
  );
}

function blankMileage(vehicle_id: string): MileageInput {
  return {
    trip_date: today(),
    vehicle_id,
    employee_id: null,
    crew_id: null,
    job_id: null,
    client_id: null,
    property_id: null,
    trip_purpose: "",
    start_location: null,
    end_location: null,
    start_odometer: null,
    end_odometer: null,
    miles: 0,
    round_trip: false,
    business_use: true,
    mileage_rate: null,
    notes: null,
  };
}
function pickVehicle(x: VehicleWithRelations): VehicleInput {
  return {
    nickname: x.nickname,
    year: x.year,
    make: x.make,
    model: x.model,
    color: x.color,
    license_plate: x.license_plate,
    vin: x.vin,
    vehicle_type: x.vehicle_type,
    ownership_type: x.ownership_type,
    status: x.status,
    assigned_employee_id: x.assigned_employee_id,
    assigned_crew_id: x.assigned_crew_id,
    current_odometer: x.current_odometer,
    notes: x.notes,
  };
}
function pickMileage(x: MileageWithRelations): MileageInput {
  return {
    trip_date: x.trip_date,
    vehicle_id: x.vehicle_id,
    employee_id: x.employee_id,
    crew_id: x.crew_id,
    job_id: x.job_id,
    client_id: x.client_id,
    property_id: x.property_id,
    trip_purpose: x.trip_purpose,
    start_location: x.start_location,
    end_location: x.end_location,
    start_odometer: x.start_odometer,
    end_odometer: x.end_odometer,
    miles: x.miles,
    round_trip: x.round_trip,
    business_use: x.business_use,
    mileage_rate: x.mileage_rate,
    notes: x.notes,
  };
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4">
      <section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-6">
        <button className="float-right text-xl" onClick={close}>
          ×
        </button>
        <h2 className="mb-5 text-xl font-extrabold text-[#143d1a]">{title}</h2>
        {children}
      </section>
    </div>
  );
}
function Field({
  l,
  v,
  set,
  type = "text",
}: {
  l: string;
  v: string;
  set: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="text-sm font-bold">
      {l}
      <input
        className={input}
        type={type}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? ".01" : undefined}
        value={v}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}
function LabeledSelect({
  l,
  v,
  set,
  values,
}: {
  l: string;
  v: string;
  set: (v: string) => void;
  values: readonly string[];
}) {
  return (
    <label className="text-sm font-bold">
      {l}
      <select className={input} value={v} onChange={(e) => set(e.target.value)}>
        {values.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
    </label>
  );
}
function Assoc({
  l,
  v,
  set,
  rows,
  required,
}: {
  l: string;
  v: string | null;
  set: (v: string | null) => void;
  rows: string[][];
  required?: boolean;
}) {
  return (
    <label className="text-sm font-bold">
      {l}
      <select
        className={input}
        required={required}
        value={v ?? ""}
        onChange={(e) => set(e.target.value || null)}
      >
        <option value="">{required ? "Select" : "None"}</option>
        {rows.map((x) => (
          <option key={x[0]} value={x[0]}>
            {x[1]}
          </option>
        ))}
      </select>
    </label>
  );
}
function Select({
  v,
  set,
  options,
}: {
  v: string;
  set: (v: string) => void;
  options: string[][];
}) {
  return (
    <select className={input} value={v} onChange={(e) => set(e.target.value)}>
      {options.map((x) => (
        <option key={x[0]} value={x[0]}>
          {x[1]}
        </option>
      ))}
    </select>
  );
}
function Card({ l, v }: { l: string; v: string }) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <p className="text-xs uppercase text-neutral-500">{l}</p>
      <b className="mt-2 block text-xl text-[#143d1a]">{v}</b>
    </div>
  );
}
function Alert({ text, good }: { text: string; good?: boolean }) {
  return (
    <div
      className={`mt-4 rounded-lg p-3 ${good ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
    >
      {text}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="p-8 text-center text-neutral-500">{text}</p>;
}
function dateMatch(d: string, f: string) {
  const n = new Date(),
    month = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  if (f === "This Month") return d.startsWith(month);
  if (f === "Last Month") {
    const x = new Date(n.getFullYear(), n.getMonth() - 1);
    return d.startsWith(
      `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`,
    );
  }
  if (f === "This Year") return d.startsWith(String(n.getFullYear()));
  return true;
}
function sortMileage(
  a: MileageWithRelations,
  b: MileageWithRelations,
  s: string,
) {
  if (s === "Oldest") return a.trip_date.localeCompare(b.trip_date);
  if (s === "Miles High to Low") return b.miles - a.miles;
  if (s === "Miles Low to High") return a.miles - b.miles;
  if (s === "Deduction High to Low")
    return b.deductible_amount - a.deductible_amount;
  if (s === "Vehicle")
    return vehicleLabel(a.vehicle).localeCompare(vehicleLabel(b.vehicle));
  return b.trip_date.localeCompare(a.trip_date);
}
function exportCsv(rows: MileageWithRelations[]) {
  try {
    const data = [
      [
        "Date",
        "Mileage Number",
        "Vehicle",
        "Employee",
        "Crew",
        "Job",
        "Client",
        "Trip Purpose",
        "Start Location",
        "End Location",
        "Miles",
        "Business Use",
        "Mileage Rate",
        "Deductible Amount",
      ],
      ...rows.map((x) => [
        x.trip_date,
        x.mileage_number,
        vehicleLabel(x.vehicle),
        x.employee ? `${x.employee.first_name} ${x.employee.last_name}` : "",
        x.crew?.crew_name || "",
        x.job?.job_number || "",
        x.client?.company_name || x.client?.first_name || "",
        x.trip_purpose,
        x.start_location || "",
        x.end_location || "",
        String(x.miles),
        x.business_use ? "Yes" : "No",
        String(x.mileage_rate ?? ""),
        String(x.deductible_amount),
      ]),
    ];
    const blob = new Blob(
        [
          data
            .map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(","))
            .join("\r\n"),
        ],
        { type: "text/csv" },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "studioscrubz-mileage.csv";
    a.click();
    URL.revokeObjectURL(url);
  } catch (x) {
    console.error(x);
    alert("Mileage export failed.");
  }
}
function unique(rows: string[][]) {
  return [...new Map(rows.map((x) => [x[0], x])).values()];
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function money(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}
function msg(x: unknown) {
  console.error(x);
  return x instanceof Error ? x.message : "Operation failed.";
}
const input = "mt-1 h-11 w-full rounded-lg border px-3";
const primary =
  "rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50";
const secondary =
  "rounded-lg border px-3 py-2 text-xs font-bold text-[#143d1a]";
