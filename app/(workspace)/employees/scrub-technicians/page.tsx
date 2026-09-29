import { EmployeeDirectory } from "@/components/employees/EmployeeDirectory";

export default function Page() {
  return (
    <EmployeeDirectory
      departments={["Scrub Technicians"]}
      title="Active Scrub Technicians"
      description="Active Scrub Technicians supporting StudioScrubz operations."
      directory={false}
      activeScrubTechsOnly
    />
  );
}