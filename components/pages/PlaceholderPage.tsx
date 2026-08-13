import { PageHeader } from "@/components/layout/PageHeader";
import { PlaceholderCard } from "@/components/ui/PlaceholderCard";

export function PlaceholderPage({ title, description, placeholder }: { title: string; description: string; placeholder: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <PlaceholderCard>{placeholder}</PlaceholderCard>
    </>
  );
}
