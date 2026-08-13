import { ArchivesPage } from "@/components/archives/ArchivesPage";
import { SensitiveRoute } from "@/components/auth/SensitiveRoute";

export default function Page() { return <SensitiveRoute area="archives"><ArchivesPage /></SensitiveRoute>; }
