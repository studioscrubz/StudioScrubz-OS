import type { Client, ClientInput } from "@/types/client";
import type { Property, PropertyInput } from "@/types/property";
import type { Estimate, EstimateInsert, EstimateUpdate } from "@/types/estimate";

export interface Database {
  public: {
    Tables: {
      clients: {
        Row: Client;
        Insert: ClientInput & { id?: string; created_at?: string; updated_at?: string; archived_at?: string | null };
        Update: Partial<ClientInput> & { updated_at?: string; archived_at?: string | null };
        Relationships: [];
      };
      properties: {
        Row: Property;
        Insert: PropertyInput & { id?: string; created_at?: string; updated_at?: string; archived_at?: string | null };
        Update: Partial<PropertyInput> & { updated_at?: string; archived_at?: string | null };
        Relationships: [{ foreignKeyName: "properties_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] }];
      };
      estimates: {
        Row: Estimate;
        Insert: EstimateInsert & { id?: string; created_at?: string; updated_at?: string };
        Update: EstimateUpdate;
        Relationships: [
          { foreignKeyName: "estimates_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "estimates_property_id_fkey"; columns: ["property_id"]; isOneToOne: false; referencedRelation: "properties"; referencedColumns: ["id"] },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
