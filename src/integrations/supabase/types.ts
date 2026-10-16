export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      push_test_receipts: {
        Row: {
          id: string;
          received_at: string | null;
          sent_at: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          received_at?: string | null;
          sent_at?: string;
          user_id: string;
        };
        Update: {
          id?: string;
          received_at?: string | null;
          sent_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      airport_observations: {
        Row: {
          fetched_at: string;
          gust_kt: number | null;
          id: string;
          lat: number;
          lon: number;
          name: string | null;
          observed_at: string;
          raw: string;
          station: string;
          temp_c: number | null;
          visibility_m: number | null;
          weather: string | null;
          wind_kt: number | null;
        };
        Insert: {
          fetched_at?: string;
          gust_kt?: number | null;
          id?: string;
          lat: number;
          lon: number;
          name?: string | null;
          observed_at: string;
          raw: string;
          station: string;
          temp_c?: number | null;
          visibility_m?: number | null;
          weather?: string | null;
          wind_kt?: number | null;
        };
        Update: {
          fetched_at?: string;
          gust_kt?: number | null;
          id?: string;
          lat?: number;
          lon?: number;
          name?: string | null;
          observed_at?: string;
          raw?: string;
          station?: string;
          temp_c?: number | null;
          visibility_m?: number | null;
          weather?: string | null;
          wind_kt?: number | null;
        };
        Relationships: [];
      };
      cold_exports: {
        Row: {
          bytes: number | null;
          day: string;
          exported_at: string;
          key_digest: string | null;
          path: string | null;
          rows: number;
          sha256: string | null;
          table_name: string;
        };
        Insert: {
          bytes?: number | null;
          day: string;
          exported_at?: string;
          key_digest?: string | null;
          path?: string | null;
          rows: number;
          sha256?: string | null;
          table_name: string;
        };
        Update: {
          bytes?: number | null;
          day?: string;
          exported_at?: string;
          key_digest?: string | null;
          path?: string | null;
          rows?: number;
          sha256?: string | null;
          table_name?: string;
        };
        Relationships: [];
      };
      onm_areas: {
        Row: {
          id: string;
          polygon: Json;
        };
        Insert: {
          id: string;
          polygon: Json;
        };
        Update: {
          id?: string;
          polygon?: Json;
        };
        Relationships: [];
      };
      civil_decisions: {
        Row: {
          attempt: number;
          created_at: string;
          decision: Json;
          id: string;
          investigation_id: string;
          model: string;
          publication_id: string | null;
          source_extraction: Json;
          trace: Json;
          version: string;
        };
        Insert: {
          attempt: number;
          created_at?: string;
          decision: Json;
          id?: string;
          investigation_id: string;
          model: string;
          publication_id?: string | null;
          source_extraction: Json;
          trace: Json;
          version: string;
        };
        Update: {
          attempt?: number;
          created_at?: string;
          decision?: Json;
          id?: string;
          investigation_id?: string;
          model?: string;
          publication_id?: string | null;
          source_extraction?: Json;
          trace?: Json;
          version?: string;
        };
        Relationships: [
          {
            foreignKeyName: "civil_decisions_investigation_id_fkey";
            columns: ["investigation_id"];
            isOneToOne: false;
            referencedRelation: "civil_investigations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "civil_decisions_publication_id_fkey";
            columns: ["publication_id"];
            isOneToOne: false;
            referencedRelation: "civil_publications";
            referencedColumns: ["id"];
          },
        ];
      };
      civil_investigations: {
        Row: {
          attempts: number;
          error: string | null;
          failures: number;
          id: string;
          incident_index: number;
          job_attempt: number | null;
          job_id: string | null;
          next_attempt_at: string;
          report_id: string;
          state: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          error?: string | null;
          failures?: number;
          id?: string;
          incident_index: number;
          job_attempt?: number | null;
          job_id?: string | null;
          next_attempt_at?: string;
          report_id: string;
          state?: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          error?: string | null;
          failures?: number;
          id?: string;
          incident_index?: number;
          job_attempt?: number | null;
          job_id?: string | null;
          next_attempt_at?: string;
          report_id?: string;
          state?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "civil_investigations_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "source_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "civil_investigations_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "ita_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      civil_publication_revisions: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_kind: string;
          created_at: string;
          id: string;
          new_payload: Json;
          prior_payload: Json | null;
          publication_id: string;
          reason: string;
          revision: number;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_kind?: string;
          created_at?: string;
          id?: string;
          new_payload: Json;
          prior_payload?: Json | null;
          publication_id: string;
          reason: string;
          revision: number;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_kind?: string;
          created_at?: string;
          id?: string;
          new_payload?: Json;
          prior_payload?: Json | null;
          publication_id?: string;
          reason?: string;
          revision?: number;
        };
        Relationships: [
          {
            foreignKeyName: "civil_publication_revisions_publication_id_fkey";
            columns: ["publication_id"];
            isOneToOne: false;
            referencedRelation: "civil_publications";
            referencedColumns: ["id"];
          },
        ];
      };
      civil_publications: {
        Row: {
          area_id: string;
          cap_references: Json;
          expires_at: string;
          hazard: string;
          id: string;
          incident_index: number;
          ita_report_id: string;
          published_at: string;
          revision: number;
          source_name: string;
          source_published_at: string;
          source_url: string;
          state: string;
          summary: string;
          updated_at: string;
        };
        Insert: {
          area_id: string;
          cap_references?: Json;
          expires_at: string;
          hazard: string;
          id?: string;
          incident_index: number;
          ita_report_id: string;
          published_at?: string;
          revision?: number;
          source_name: string;
          source_published_at: string;
          source_url: string;
          state?: string;
          summary: string;
          updated_at?: string;
        };
        Update: {
          area_id?: string;
          cap_references?: Json;
          expires_at?: string;
          hazard?: string;
          id?: string;
          incident_index?: number;
          ita_report_id?: string;
          published_at?: string;
          revision?: number;
          source_name?: string;
          source_published_at?: string;
          source_url?: string;
          state?: string;
          summary?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "civil_publications_area_id_fkey";
            columns: ["area_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "civil_publications_ita_report_id_fkey";
            columns: ["ita_report_id"];
            isOneToOne: false;
            referencedRelation: "ita_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      weather_snapshots: {
        Row: {
          id: string;
          commune_id: string;
          scheduled_at: string;
          fetched_at: string;
          job_id: string | null;
          evidence: Json;
        };
        Insert: {
          id?: string;
          commune_id: string;
          scheduled_at: string;
          fetched_at: string;
          job_id?: string | null;
          evidence: Json;
        };
        Update: {
          id?: string;
          commune_id?: string;
          scheduled_at?: string;
          fetched_at?: string;
          job_id?: string | null;
          evidence?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "weather_snapshots_commune_id_fkey";
            columns: ["commune_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "weather_snapshots_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "source_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_outbox: {
        Row: {
          alert_id: string;
          attempts: number;
          available_at: string;
          created_at: string;
          endpoint_id: string;
          id: string;
          lease_token: string | null;
          lease_until: string | null;
          payload: Json;
          state: string;
          user_id: string;
        };
        Insert: {
          alert_id: string;
          attempts?: number;
          available_at?: string;
          created_at?: string;
          endpoint_id: string;
          id?: string;
          lease_token?: string | null;
          lease_until?: string | null;
          payload: Json;
          state?: string;
          user_id: string;
        };
        Update: {
          alert_id?: string;
          attempts?: number;
          available_at?: string;
          created_at?: string;
          endpoint_id?: string;
          id?: string;
          lease_token?: string | null;
          lease_until?: string | null;
          payload?: Json;
          state?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "webhook_outbox_alert_id_fkey";
            columns: ["alert_id"];
            isOneToOne: false;
            referencedRelation: "alerts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "webhook_outbox_endpoint_id_fkey";
            columns: ["endpoint_id"];
            isOneToOne: false;
            referencedRelation: "webhook_endpoints";
            referencedColumns: ["id"];
          },
        ];
      };
      source_captures: {
        Row: {
          attempt: number | null;
          byte_length: number | null;
          code_revision: string | null;
          contract_version: number | null;
          endpoint: string;
          error_code: string | null;
          fetched_at: string;
          http_status: number | null;
          id: string;
          job_id: string | null;
          media_type: string | null;
          parser_version: string | null;
          recorded_at: string;
          request_params: Json;
          requested_at: string;
          response_headers: Json;
          sha256: string | null;
          source_key: string;
          source_origin: string;
          status: string;
          storage_path: string | null;
        };
        Insert: {
          attempt?: number | null;
          byte_length?: number | null;
          code_revision?: string | null;
          contract_version?: number | null;
          endpoint: string;
          error_code?: string | null;
          fetched_at: string;
          http_status?: number | null;
          id?: string;
          job_id?: string | null;
          media_type?: string | null;
          parser_version?: string | null;
          recorded_at?: string;
          request_params?: Json;
          requested_at: string;
          response_headers?: Json;
          sha256?: string | null;
          source_key: string;
          source_origin: string;
          status: string;
          storage_path?: string | null;
        };
        Update: {
          attempt?: number | null;
          byte_length?: number | null;
          code_revision?: string | null;
          contract_version?: number | null;
          endpoint?: string;
          error_code?: string | null;
          fetched_at?: string;
          http_status?: number | null;
          id?: string;
          job_id?: string | null;
          media_type?: string | null;
          parser_version?: string | null;
          recorded_at?: string;
          request_params?: Json;
          requested_at?: string;
          response_headers?: Json;
          sha256?: string | null;
          source_key?: string;
          source_origin?: string;
          status?: string;
          storage_path?: string | null;
        };
        Relationships: [];
      };
      ita_feed_state: {
        Row: {
          checked_at: string | null;
          etag: string | null;
          singleton: boolean;
        };
        Insert: {
          checked_at?: string | null;
          etag?: string | null;
          singleton?: boolean;
        };
        Update: {
          checked_at?: string | null;
          etag?: string | null;
          singleton?: boolean;
        };
        Relationships: [];
      };
      ita_reports: {
        Row: {
          body: string;
          content_hash: string;
          extracted_at: string | null;
          extraction: Json | null;
          extraction_attempts: number;
          extraction_error: string | null;
          extraction_requeued_at: string | null;
          fetched_at: string;
          id: string;
          next_extraction_at: string;
          published_at: string;
          raw: Json;
          recovery_version: string;
          source_page: string;
          source_post_id: string;
          source_url: string;
        };
        Insert: {
          body: string;
          content_hash: string;
          extracted_at?: string | null;
          extraction?: Json | null;
          extraction_attempts?: number;
          extraction_error?: string | null;
          extraction_requeued_at?: string | null;
          fetched_at?: string;
          id?: string;
          next_extraction_at?: string;
          published_at: string;
          raw: Json;
          recovery_version?: string;
          source_page: string;
          source_post_id: string;
          source_url: string;
        };
        Update: {
          body?: string;
          content_hash?: string;
          extracted_at?: string | null;
          extraction?: Json | null;
          extraction_attempts?: number;
          extraction_error?: string | null;
          extraction_requeued_at?: string | null;
          fetched_at?: string;
          id?: string;
          next_extraction_at?: string;
          published_at?: string;
          raw?: Json;
          recovery_version?: string;
          source_page?: string;
          source_post_id?: string;
          source_url?: string;
        };
        Relationships: [];
      };

      source_run_retired_keys: {
        Row: {
          idempotency_key: string;
          retired_at: string;
        };
        Insert: {
          idempotency_key: string;
          retired_at?: string;
        };
        Update: {
          idempotency_key?: string;
          retired_at?: string;
        };
        Relationships: [];
      };
      broadcast_delivery_queue: {
        Row: {
          attempts: number;
          broadcast_id: string;
          channel: string;
          created_at: string;
          expires_at: string;
          last_error: string | null;
          lease_token: string | null;
          lease_until: string | null;
          next_attempt_at: string;
          state: string;
        };
        Insert: {
          attempts?: number;
          broadcast_id: string;
          channel: string;
          created_at?: string;
          expires_at: string;
          last_error?: string | null;
          lease_token?: string | null;
          lease_until?: string | null;
          next_attempt_at?: string;
          state?: string;
        };
        Update: {
          attempts?: number;
          broadcast_id?: string;
          channel?: string;
          created_at?: string;
          expires_at?: string;
          last_error?: string | null;
          lease_token?: string | null;
          lease_until?: string | null;
          next_attempt_at?: string;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: "broadcast_delivery_queue_broadcast_id_fkey";
            columns: ["broadcast_id"];
            isOneToOne: false;
            referencedRelation: "broadcasts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcast_delivery_queue_channel_fkey";
            columns: ["channel"];
            isOneToOne: false;
            referencedRelation: "delivery_channel_settings";
            referencedColumns: ["channel"];
          },
          {
            foreignKeyName: "broadcast_delivery_queue_channel_fkey";
            columns: ["channel"];
            isOneToOne: false;
            referencedRelation: "delivery_queue_health";
            referencedColumns: ["channel"];
          },
        ];
      };
      delivery_channel_settings: {
        Row: {
          channel: string;
          paused: boolean;
        };
        Insert: {
          channel: string;
          paused?: boolean;
        };
        Update: {
          channel?: string;
          paused?: boolean;
        };
        Relationships: [];
      };
      operational_incidents: {
        Row: {
          acknowledged_at: string | null;
          acknowledged_by: string | null;
          contract_key: string;
          first_seen_at: string;
          id: string;
          last_seen_at: string;
          reason_code: string;
          resolved_at: string | null;
        };
        Insert: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          contract_key: string;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          reason_code: string;
          resolved_at?: string | null;
        };
        Update: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          contract_key?: string;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          reason_code?: string;
          resolved_at?: string | null;
        };
        Relationships: [];
      };
      admin_units: {
        Row: {
          code: string;
          created_at: string;
          forest_fraction: number;
          geom: Json | null;
          id: string;
          landcover: Json | null;
          lat: number;
          level: string;
          lon: number;
          name_ar: string;
          name_en: string;
          name_fr: string;
          name_kab: string | null;
          parent_id: string | null;
          population: number | null;
          terrain: Json | null;
        };
        Insert: {
          code: string;
          created_at?: string;
          forest_fraction?: number;
          geom?: Json | null;
          id?: string;
          landcover?: Json | null;
          lat: number;
          level: string;
          lon: number;
          name_ar: string;
          name_en: string;
          name_fr: string;
          name_kab?: string | null;
          parent_id?: string | null;
          population?: number | null;
          terrain?: Json | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          forest_fraction?: number;
          geom?: Json | null;
          id?: string;
          landcover?: Json | null;
          lat?: number;
          level?: string;
          lon?: number;
          name_ar?: string;
          name_en?: string;
          name_fr?: string;
          name_kab?: string | null;
          parent_id?: string | null;
          population?: number | null;
          terrain?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "admin_units_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };

      alerts: {
        Row: {
          body: string;
          cap_alert_id: string | null;
          cluster_id: string | null;
          commune_id: string | null;
          created_at: string;
          dedupe_key: string;
          delivered_email: boolean;
          delivered_webhook: boolean;
          distance_km: number | null;
          id: string;
          kind: string;
          payload: Json | null;
          push_attempts: number;
          push_claimed_at: string | null;
          push_received_at: string | null;
          push_state: string;
          read_at: string | null;
          severity: number;
          source_id: string | null;
          source_table: string | null;
          title: string;
          user_id: string;
          zone_id: string | null;
        };
        Insert: {
          body: string;
          cap_alert_id?: string | null;
          cluster_id?: string | null;
          commune_id?: string | null;
          created_at?: string;
          dedupe_key: string;
          delivered_email?: boolean;
          delivered_webhook?: boolean;
          distance_km?: number | null;
          id?: string;
          kind: string;
          payload?: Json | null;
          push_attempts?: number;
          push_claimed_at?: string | null;
          push_received_at?: string | null;
          push_state?: string;
          read_at?: string | null;
          severity?: number;
          source_id?: string | null;
          source_table?: string | null;
          title: string;
          user_id: string;
          zone_id?: string | null;
        };
        Update: {
          body?: string;
          cap_alert_id?: string | null;
          cluster_id?: string | null;
          commune_id?: string | null;
          created_at?: string;
          dedupe_key?: string;
          delivered_email?: boolean;
          delivered_webhook?: boolean;
          distance_km?: number | null;
          id?: string;
          kind?: string;
          payload?: Json | null;
          push_attempts?: number;
          push_claimed_at?: string | null;
          push_received_at?: string | null;
          push_state?: string;
          read_at?: string | null;
          severity?: number;
          source_id?: string | null;
          source_table?: string | null;
          title?: string;
          user_id?: string;
          zone_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "alerts_cap_alert_id_fkey";
            columns: ["cap_alert_id"];
            isOneToOne: false;
            referencedRelation: "cap_alerts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "alerts_cluster_id_fkey";
            columns: ["cluster_id"];
            isOneToOne: false;
            referencedRelation: "fire_clusters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "alerts_commune_id_fkey";
            columns: ["commune_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "alerts_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      authority_warnings: {
        Row: {
          body: string;
          commune_codes: string[] | null;
          created_at: string;
          created_by: string | null;
          id: string;
          received_via: string;
          severity: string;
          source: string;
          wilaya_id: string | null;
        };
        Insert: {
          body: string;
          commune_codes?: string[] | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          received_via: string;
          severity: string;
          source: string;
          wilaya_id?: string | null;
        };
        Update: {
          body?: string;
          commune_codes?: string[] | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          received_via?: string;
          severity?: string;
          source?: string;
          wilaya_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "authority_warnings_wilaya_id_fkey";
            columns: ["wilaya_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };
      broadcast_audit: {
        Row: {
          action: string;
          actor_id: string | null;
          at: string;
          cluster_id: string | null;
          commune_codes: string[] | null;
          id: string;
          kind: string | null;
          onm_vigilance_id: string | null;
          payload: Json | null;
          phase: string | null;
          reason: string;
          severity: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          at?: string;
          cluster_id?: string | null;
          commune_codes?: string[] | null;
          id?: string;
          kind?: string | null;
          onm_vigilance_id?: string | null;
          payload?: Json | null;
          phase?: string | null;
          reason: string;
          severity?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          at?: string;
          cluster_id?: string | null;
          commune_codes?: string[] | null;
          id?: string;
          kind?: string | null;
          onm_vigilance_id?: string | null;
          payload?: Json | null;
          phase?: string | null;
          reason?: string;
          severity?: string | null;
        };
        Relationships: [];
      };
      broadcast_delivery_receipts: {
        Row: {
          broadcast_id: string;
          channel: string;
          delivered_at: string;
          destination: string;
        };
        Insert: {
          broadcast_id: string;
          channel: string;
          delivered_at?: string;
          destination: string;
        };
        Update: {
          broadcast_id?: string;
          channel?: string;
          delivered_at?: string;
          destination?: string;
        };
        Relationships: [
          {
            foreignKeyName: "broadcast_delivery_receipts_broadcast_id_fkey";
            columns: ["broadcast_id"];
            isOneToOne: false;
            referencedRelation: "broadcasts";
            referencedColumns: ["id"];
          },
        ];
      };
      broadcast_settings: {
        Row: {
          enabled: boolean;
          id: boolean;
          updated_at: string;
        };
        Insert: {
          enabled?: boolean;
          id?: boolean;
          updated_at?: string;
        };
        Update: {
          enabled?: boolean;
          id?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      broadcasts: {
        Row: {
          authority_warning_id: string | null;
          cap_alert_id: string | null;
          cluster_id: string | null;
          commune_codes: string[];
          created_at: string;
          fcm_delivered_at: string | null;
          fcm_topics: number | null;
          id: string;
          inside_codes: string[];
          kind: string;
          official_incident_id: string | null;
          onm_vigilance_id: string | null;
          phase: string;
          push_codes: string[];
          severity: string;
          telegram_channels: number | null;
          telegram_delivered_at: string | null;
        };
        Insert: {
          authority_warning_id?: string | null;
          cap_alert_id?: string | null;
          cluster_id?: string | null;
          commune_codes: string[];
          created_at?: string;
          fcm_delivered_at?: string | null;
          fcm_topics?: number | null;
          id?: string;
          inside_codes?: string[];
          kind: string;
          official_incident_id?: string | null;
          onm_vigilance_id?: string | null;
          phase?: string;
          push_codes: string[];
          severity: string;
          telegram_channels?: number | null;
          telegram_delivered_at?: string | null;
        };
        Update: {
          authority_warning_id?: string | null;
          cap_alert_id?: string | null;
          cluster_id?: string | null;
          commune_codes?: string[];
          created_at?: string;
          fcm_delivered_at?: string | null;
          fcm_topics?: number | null;
          id?: string;
          inside_codes?: string[];
          kind?: string;
          official_incident_id?: string | null;
          onm_vigilance_id?: string | null;
          phase?: string;
          push_codes?: string[];
          severity?: string;
          telegram_channels?: number | null;
          telegram_delivered_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "broadcasts_authority_warning_id_fkey";
            columns: ["authority_warning_id"];
            isOneToOne: false;
            referencedRelation: "authority_warnings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcasts_cap_alert_id_fkey";
            columns: ["cap_alert_id"];
            isOneToOne: false;
            referencedRelation: "cap_alerts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcasts_cluster_id_fkey";
            columns: ["cluster_id"];
            isOneToOne: false;
            referencedRelation: "fire_clusters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcasts_official_incident_id_fkey";
            columns: ["official_incident_id"];
            isOneToOne: false;
            referencedRelation: "official_incidents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcasts_onm_vigilance_id_fkey";
            columns: ["onm_vigilance_id"];
            isOneToOne: false;
            referencedRelation: "onm_vigilance";
            referencedColumns: ["id"];
          },
        ];
      };
      cap_alerts: {
        Row: {
          cap_references: string | null;
          cluster_id: string | null;
          created_at: string;
          id: string;
          identifier: string;
          info: Json;
          msg_type: string;
          scope: string;
          sender: string;
          sent: string;
          status: string;
        };
        Insert: {
          cap_references?: string | null;
          cluster_id?: string | null;
          created_at?: string;
          id?: string;
          identifier: string;
          info: Json;
          msg_type: string;
          scope: string;
          sender: string;
          sent: string;
          status: string;
        };
        Update: {
          cap_references?: string | null;
          cluster_id?: string | null;
          created_at?: string;
          id?: string;
          identifier?: string;
          info?: Json;
          msg_type?: string;
          scope?: string;
          sender?: string;
          sent?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cap_alerts_cluster_id_fkey";
            columns: ["cluster_id"];
            isOneToOne: false;
            referencedRelation: "fire_clusters";
            referencedColumns: ["id"];
          },
        ];
      };
      citizen_report_submissions: {
        Row: {
          created_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      citizen_reports: {
        Row: {
          classified_at: string | null;
          classifier: string | null;
          cluster_id: string | null;
          commune_id: string | null;
          created_at: string;
          expires_at: string | null;
          flagged_at: string | null;
          user_flagged_at: string | null;
          hazard: string | null;
          id: string;
          kind: string;
          lat: number;
          lon: number;
          moderation_note: string | null;
          note: string | null;
          observed_at: string;
          photo_url: string | null;
          publish_state: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          sighting: string;
          size_hint: string;
          status: string;
          summary: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          classified_at?: string | null;
          classifier?: string | null;
          cluster_id?: string | null;
          commune_id?: string | null;
          created_at?: string;
          expires_at?: string | null;
          flagged_at?: string | null;
          user_flagged_at?: string | null;
          hazard?: string | null;
          id?: string;
          kind?: string;
          lat: number;
          lon: number;
          moderation_note?: string | null;
          note?: string | null;
          observed_at?: string;
          photo_url?: string | null;
          publish_state?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sighting?: string;
          size_hint?: string;
          status?: string;
          summary?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          classified_at?: string | null;
          classifier?: string | null;
          cluster_id?: string | null;
          commune_id?: string | null;
          created_at?: string;
          expires_at?: string | null;
          flagged_at?: string | null;
          user_flagged_at?: string | null;
          hazard?: string | null;
          id?: string;
          kind?: string;
          lat?: number;
          lon?: number;
          moderation_note?: string | null;
          note?: string | null;
          observed_at?: string;
          photo_url?: string | null;
          publish_state?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sighting?: string;
          size_hint?: string;
          status?: string;
          summary?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "citizen_reports_cluster_id_fkey";
            columns: ["cluster_id"];
            isOneToOne: false;
            referencedRelation: "fire_clusters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "citizen_reports_commune_id_fkey";
            columns: ["commune_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };
      cluster_events: {
        Row: {
          at: string;
          cluster_id: string;
          event: string;
          id: string;
          payload: Json | null;
        };
        Insert: {
          at?: string;
          cluster_id: string;
          event: string;
          id?: string;
          payload?: Json | null;
        };
        Update: {
          at?: string;
          cluster_id?: string;
          event?: string;
          id?: string;
          payload?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "cluster_events_cluster_id_fkey";
            columns: ["cluster_id"];
            isOneToOne: false;
            referencedRelation: "fire_clusters";
            referencedColumns: ["id"];
          },
        ];
      };
      contribution_idea_votes: {
        Row: {
          created_at: string;
          idea_id: string;
          value: number;
          voter_key: string;
        };
        Insert: {
          created_at?: string;
          idea_id: string;
          value: number;
          voter_key: string;
        };
        Update: {
          created_at?: string;
          idea_id?: string;
          value?: number;
          voter_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contribution_idea_votes_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "contribution_ideas";
            referencedColumns: ["id"];
          },
        ];
      };
      contribution_ideas: {
        Row: {
          reply: string | null;
          replied_at: string | null;
          replied_by: string | null;
          reply_author_kind: string | null;
          contact: string | null;
          created_at: string;
          id: string;
          lane: string;
          locale: string;
          message: string;
          moderated_by: string | null;
          moderation_note: string | null;
          published_at: string | null;
          score: number;
          status: string;
        };
        Insert: {
          reply?: string | null;
          replied_at?: string | null;
          replied_by?: string | null;
          reply_author_kind?: string | null;
          contact?: string | null;
          created_at?: string;
          id?: string;
          lane?: string;
          locale?: string;
          message: string;
          moderated_by?: string | null;
          moderation_note?: string | null;
          published_at?: string | null;
          score?: number;
          status?: string;
        };
        Update: {
          reply?: string | null;
          replied_at?: string | null;
          replied_by?: string | null;
          reply_author_kind?: string | null;
          contact?: string | null;
          created_at?: string;
          id?: string;
          lane?: string;
          locale?: string;
          message?: string;
          moderated_by?: string | null;
          moderation_note?: string | null;
          published_at?: string | null;
          score?: number;
          status?: string;
        };
        Relationships: [];
      };
      data_sources: {
        Row: {
          id: string;
          label: string;
          last_ok_at: string | null;
          name: string;
          note: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          label: string;
          last_ok_at?: string | null;
          name: string;
          note?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          label?: string;
          last_ok_at?: string | null;
          name?: string;
          note?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      detections: {
        Row: {
          cluster_id: string | null;
          confidence_raw: number;
          created_at: string;
          daynight: string | null;
          detected_at: string;
          fp_reason: string | null;
          frp_mw: number | null;
          id: string;
          lat: number;
          lon: number;
          natural_key: string;
          raw: Json | null;
          sensor: string;
          source: string;
        };
        Insert: {
          cluster_id?: string | null;
          confidence_raw: number;
          created_at?: string;
          daynight?: string | null;
          detected_at: string;
          fp_reason?: string | null;
          frp_mw?: number | null;
          id?: string;
          lat: number;
          lon: number;
          natural_key: string;
          raw?: Json | null;
          sensor: string;
          source: string;
        };
        Update: {
          cluster_id?: string | null;
          confidence_raw?: number;
          created_at?: string;
          daynight?: string | null;
          detected_at?: string;
          fp_reason?: string | null;
          frp_mw?: number | null;
          id?: string;
          lat?: number;
          lon?: number;
          natural_key?: string;
          raw?: Json | null;
          sensor?: string;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: "detections_cluster_id_fkey";
            columns: ["cluster_id"];
            isOneToOne: false;
            referencedRelation: "fire_clusters";
            referencedColumns: ["id"];
          },
        ];
      };
      document_extractions: {
        Row: {
          attempts: number;
          document_id: string;
          last_error: string | null;
          next_attempt_at: string;
          recovery_version: string;
          requeued_at: string | null;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          document_id: string;
          last_error?: string | null;
          next_attempt_at?: string;
          recovery_version?: string;
          requeued_at?: string | null;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          document_id?: string;
          last_error?: string | null;
          next_attempt_at?: string;
          recovery_version?: string;
          requeued_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_extractions_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: true;
            referencedRelation: "source_documents";
            referencedColumns: ["id"];
          },
        ];
      };
      effis_danger: {
        Row: {
          commune_id: string;
          created_at: string;
          danger_class: string;
          date: string;
          id: string;
        };
        Insert: {
          commune_id: string;
          created_at?: string;
          danger_class: string;
          date: string;
          id?: string;
        };
        Update: {
          commune_id?: string;
          created_at?: string;
          danger_class?: string;
          date?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "effis_danger_commune_id_fkey";
            columns: ["commune_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };
      earthquakes: {
        Row: {
          commune_id: string | null;
          depth_km: number | null;
          fetched_at: string;
          id: string;
          lat: number;
          lon: number;
          magnitude: number;
          magnitude_type: string | null;
          network: string | null;
          occurred_at: string;
          offshore: boolean;
          region: string | null;
          updated_at: string;
        };
        Insert: {
          commune_id?: string | null;
          depth_km?: number | null;
          fetched_at?: string;
          id: string;
          lat: number;
          lon: number;
          magnitude: number;
          magnitude_type?: string | null;
          network?: string | null;
          occurred_at: string;
          offshore?: boolean;
          region?: string | null;
          updated_at: string;
        };
        Update: {
          commune_id?: string | null;
          depth_km?: number | null;
          fetched_at?: string;
          id?: string;
          lat?: number;
          lon?: number;
          magnitude?: number;
          magnitude_type?: string | null;
          network?: string | null;
          occurred_at?: string;
          offshore?: boolean;
          region?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      fire_clusters: {
        Row: {
          commune_id: string | null;
          confidence: number;
          confirmed_at: string | null;
          confirmed_mention_id: string | null;
          created_at: string;
          detection_count: number;
          est_area_ha: number | null;
          fci_growth: Json | null;
          first_detected_at: string;
          hull: Json | null;
          id: string;
          last_detected_at: string;
          lat: number;
          lon: number;
          max_frp_mw: number | null;
          nearest_settlement_id: string | null;
          nearest_settlement_km: number | null;
          resolution_note: string | null;
          resolution_reason: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          short_id: string;
          sources: string[];
          spread_bearing_deg: number | null;
          state: string;
          soil_moisture_m3m3: number | null;
          suspected_persistent_source: boolean;
          updated_at: string;
          vpd_kpa: number | null;
          wilaya_id: string | null;
          wind_dir_deg: number | null;
          wind_gust_kmh: number | null;
          wind_speed_kmh: number | null;
        };
        Insert: {
          commune_id?: string | null;
          confidence?: number;
          confirmed_at?: string | null;
          confirmed_mention_id?: string | null;
          created_at?: string;
          detection_count?: number;
          est_area_ha?: number | null;
          fci_growth?: Json | null;
          first_detected_at: string;
          hull?: Json | null;
          id?: string;
          last_detected_at: string;
          lat: number;
          lon: number;
          max_frp_mw?: number | null;
          nearest_settlement_id?: string | null;
          nearest_settlement_km?: number | null;
          resolution_note?: string | null;
          resolution_reason?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          short_id: string;
          sources?: string[];
          spread_bearing_deg?: number | null;
          state?: string;
          soil_moisture_m3m3?: number | null;
          suspected_persistent_source?: boolean;
          updated_at?: string;
          vpd_kpa?: number | null;
          wilaya_id?: string | null;
          wind_dir_deg?: number | null;
          wind_gust_kmh?: number | null;
          wind_speed_kmh?: number | null;
        };
        Update: {
          commune_id?: string | null;
          confidence?: number;
          confirmed_at?: string | null;
          confirmed_mention_id?: string | null;
          created_at?: string;
          detection_count?: number;
          est_area_ha?: number | null;
          fci_growth?: Json | null;
          first_detected_at?: string;
          hull?: Json | null;
          id?: string;
          last_detected_at?: string;
          lat?: number;
          lon?: number;
          max_frp_mw?: number | null;
          nearest_settlement_id?: string | null;
          nearest_settlement_km?: number | null;
          resolution_note?: string | null;
          resolution_reason?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          short_id?: string;
          sources?: string[];
          spread_bearing_deg?: number | null;
          state?: string;
          soil_moisture_m3m3?: number | null;
          suspected_persistent_source?: boolean;
          updated_at?: string;
          vpd_kpa?: number | null;
          wilaya_id?: string | null;
          wind_dir_deg?: number | null;
          wind_gust_kmh?: number | null;
          wind_speed_kmh?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "fire_clusters_commune_id_fkey";
            columns: ["commune_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fire_clusters_nearest_settlement_id_fkey";
            columns: ["nearest_settlement_id"];
            isOneToOne: false;
            referencedRelation: "settlements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fire_clusters_wilaya_id_fkey";
            columns: ["wilaya_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };
      fwi_climatology: {
        Row: {
          breakpoints: number[];
          built_at: string;
          commune_id: string;
          day: number;
          month: number;
        };
        Insert: {
          breakpoints: number[];
          built_at?: string;
          commune_id: string;
          day: number;
          month: number;
        };
        Update: {
          breakpoints?: number[];
          built_at?: string;
          commune_id?: string;
          day?: number;
          month?: number;
        };
        Relationships: [
          {
            foreignKeyName: "fwi_climatology_commune_id_fkey";
            columns: ["commune_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };
      fwi_state: {
        Row: {
          commune_id: string;
          date: string;
          dc: number;
          dmc: number;
          ffmc: number;
          inputs: string;
          updated_at: string;
        };
        Insert: {
          commune_id: string;
          date: string;
          dc: number;
          dmc: number;
          ffmc: number;
          inputs?: string;
          updated_at?: string;
        };
        Update: {
          commune_id?: string;
          date?: string;
          dc?: number;
          dmc?: number;
          ffmc?: number;
          inputs?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fwi_state_commune_id_fkey";
            columns: ["commune_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };
      ingest_runs: {
        Row: {
          error: string | null;
          finished_at: string | null;
          id: string;
          records_in: number;
          records_new: number;
          source: string;
          started_at: string;
          status: string;
        };
        Insert: {
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          records_in?: number;
          records_new?: number;
          source: string;
          started_at?: string;
          status?: string;
        };
        Update: {
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          records_in?: number;
          records_new?: number;
          source?: string;
          started_at?: string;
          status?: string;
        };
        Relationships: [];
      };
      internal_cron_token: {
        Row: {
          created_at: string;
          id: boolean;
          token: string;
        };
        Insert: {
          created_at?: string;
          id?: boolean;
          token: string;
        };
        Update: {
          created_at?: string;
          id?: boolean;
          token?: string;
        };
        Relationships: [];
      };
      admin_audit: {
        Row: {
          action: string;
          actor_kind: string;
          actor_label: string | null;
          actor_user_id: string | null;
          after: Json | null;
          at: string;
          before: Json | null;
          domain: string;
          id: string;
          reason: string | null;
          target_id: string | null;
          target_table: string;
        };
        Insert: {
          action: string;
          actor_kind: string;
          actor_label?: string | null;
          actor_user_id?: string | null;
          after?: Json | null;
          at?: string;
          before?: Json | null;
          domain: string;
          id?: string;
          reason?: string | null;
          target_id?: string | null;
          target_table: string;
        };
        Update: {
          action?: string;
          actor_kind?: string;
          actor_label?: string | null;
          actor_user_id?: string | null;
          after?: Json | null;
          at?: string;
          before?: Json | null;
          domain?: string;
          id?: string;
          reason?: string | null;
          target_id?: string | null;
          target_table?: string;
        };
        Relationships: [];
      };
      admin_unit_aliases: {
        Row: {
          admin_unit_id: string;
          alias_ar: string;
          source: string;
        };
        Insert: {
          admin_unit_id: string;
          alias_ar: string;
          source: string;
        };
        Update: {
          admin_unit_id?: string;
          alias_ar?: string;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: "admin_unit_aliases_admin_unit_id_fkey";
            columns: ["admin_unit_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };
      incident_mentions: {
        Row: {
          as_of: string;
          commune_id: string | null;
          created_at: string;
          document_id: string;
          evidence: string;
          extractor: string;
          fire_count: number;
          id: string;
          incident_id: string | null;
          kind: string;
          place_text: string | null;
          precision: string;
          status: string;
          text_source_id: string;
          wilaya_id: string;
        };
        Insert: {
          as_of: string;
          commune_id?: string | null;
          created_at?: string;
          document_id: string;
          evidence: string;
          extractor: string;
          fire_count?: number;
          id?: string;
          incident_id?: string | null;
          kind: string;
          place_text?: string | null;
          precision: string;
          status: string;
          text_source_id: string;
          wilaya_id: string;
        };
        Update: {
          as_of?: string;
          commune_id?: string | null;
          created_at?: string;
          document_id?: string;
          evidence?: string;
          extractor?: string;
          fire_count?: number;
          id?: string;
          incident_id?: string | null;
          kind?: string;
          place_text?: string | null;
          precision?: string;
          status?: string;
          text_source_id?: string;
          wilaya_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "incident_mentions_commune_id_fkey";
            columns: ["commune_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incident_mentions_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "source_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incident_mentions_incident_id_fkey";
            columns: ["incident_id"];
            isOneToOne: false;
            referencedRelation: "official_incidents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incident_mentions_text_source_id_fkey";
            columns: ["text_source_id"];
            isOneToOne: false;
            referencedRelation: "text_sources";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incident_mentions_wilaya_id_fkey";
            columns: ["wilaya_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };
      official_incidents: {
        Row: {
          as_of: string;
          authority_tier: string;
          commune_id: string | null;
          evidence: string;
          first_reported_at: string;
          id: string;
          kind: string;
          last_reported_at: string;
          latest_mention_id: string | null;
          mention_count: number;
          place_text: string | null;
          precision: string;
          status: string;
          unlisted_at: string | null;
          updated_at: string;
          wilaya_id: string;
        };
        Insert: {
          as_of: string;
          authority_tier: string;
          commune_id?: string | null;
          evidence: string;
          first_reported_at: string;
          id?: string;
          kind: string;
          last_reported_at: string;
          latest_mention_id?: string | null;
          mention_count?: number;
          place_text?: string | null;
          precision: string;
          status: string;
          unlisted_at?: string | null;
          updated_at?: string;
          wilaya_id: string;
        };
        Update: {
          as_of?: string;
          authority_tier?: string;
          commune_id?: string | null;
          evidence?: string;
          first_reported_at?: string;
          id?: string;
          kind?: string;
          last_reported_at?: string;
          latest_mention_id?: string | null;
          mention_count?: number;
          place_text?: string | null;
          precision?: string;
          status?: string;
          unlisted_at?: string | null;
          updated_at?: string;
          wilaya_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "official_incidents_commune_id_fkey";
            columns: ["commune_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "official_incidents_latest_mention_fkey";
            columns: ["latest_mention_id"];
            isOneToOne: false;
            referencedRelation: "incident_mentions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "official_incidents_wilaya_id_fkey";
            columns: ["wilaya_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };
      source_documents: {
        Row: {
          body: string;
          content_hash: string;
          external_id: string;
          fetched_at: string;
          id: string;
          published_at: string;
          raw: Json | null;
          text_source_id: string;
          url: string;
        };
        Insert: {
          body: string;
          content_hash: string;
          external_id: string;
          fetched_at?: string;
          id?: string;
          published_at: string;
          raw?: Json | null;
          text_source_id: string;
          url: string;
        };
        Update: {
          body?: string;
          content_hash?: string;
          external_id?: string;
          fetched_at?: string;
          id?: string;
          published_at?: string;
          raw?: Json | null;
          text_source_id?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "source_documents_text_source_id_fkey";
            columns: ["text_source_id"];
            isOneToOne: false;
            referencedRelation: "text_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      text_sources: {
        Row: {
          authority_tier: string;
          created_at: string;
          enabled: boolean;
          id: string;
          key: string;
          kind: string;
          label: string;
          language: string;
          template: string | null;
          url: string;
          wilaya_id: string | null;
        };
        Insert: {
          authority_tier: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          key: string;
          kind: string;
          label: string;
          language?: string;
          template?: string | null;
          url: string;
          wilaya_id?: string | null;
        };
        Update: {
          authority_tier?: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          key?: string;
          kind?: string;
          label?: string;
          language?: string;
          template?: string | null;
          url?: string;
          wilaya_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "text_sources_key_fkey";
            columns: ["key"];
            isOneToOne: true;
            referencedRelation: "source_contracts";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "text_sources_key_fkey";
            columns: ["key"];
            isOneToOne: true;
            referencedRelation: "source_health";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "text_sources_wilaya_id_fkey";
            columns: ["wilaya_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };
      operator_alert_state: {
        Row: {
          fingerprint: string;
          key: string;
          updated_at: string;
        };
        Insert: {
          fingerprint: string;
          key: string;
          updated_at?: string;
        };
        Update: {
          fingerprint?: string;
          key?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      official_weather_advice: {
        Row: {
          advice: string;
          created_at: string;
          document_id: string;
          id: string;
          valid_from: string | null;
          valid_to: string | null;
          wilaya_ids: string[];
        };
        Insert: {
          advice: string;
          created_at?: string;
          document_id: string;
          id?: string;
          valid_from?: string | null;
          valid_to?: string | null;
          wilaya_ids: string[];
        };
        Update: {
          advice?: string;
          created_at?: string;
          document_id?: string;
          id?: string;
          valid_from?: string | null;
          valid_to?: string | null;
          wilaya_ids?: string[];
        };
        Relationships: [];
      };
      onm_vigilance: {
        Row: {
          cap_detail_fetched_at: string | null;
          area_desc: string;
          area_id: string | null;
          cap_id: string;
          cap_url: string | null;
          certainty: string;
          created_at: string;
          episode_id: string;
          episode_peak: number;
          event: string;
          expires: string | null;
          headline_fr: string | null;
          id: string;
          instruction_fr: string | null;
          onset: string | null;
          sent: string;
          superseded_at: string | null;
          severity: string;
          title: string;
          urgency: string;
          wilaya_id: string | null;
        };
        Insert: {
          cap_detail_fetched_at?: string | null;
          area_desc: string;
          area_id?: string | null;
          cap_id: string;
          cap_url?: string | null;
          certainty: string;
          created_at?: string;
          episode_id?: string;
          episode_peak?: number;
          event: string;
          expires?: string | null;
          headline_fr?: string | null;
          id?: string;
          instruction_fr?: string | null;
          onset?: string | null;
          sent: string;
          superseded_at?: string | null;
          severity: string;
          title: string;
          urgency: string;
          wilaya_id?: string | null;
        };
        Update: {
          cap_detail_fetched_at?: string | null;
          area_desc?: string;
          area_id?: string | null;
          cap_id?: string;
          cap_url?: string | null;
          certainty?: string;
          created_at?: string;
          episode_id?: string;
          episode_peak?: number;
          event?: string;
          expires?: string | null;
          headline_fr?: string | null;
          id?: string;
          instruction_fr?: string | null;
          onset?: string | null;
          sent?: string;
          superseded_at?: string | null;
          severity?: string;
          title?: string;
          urgency?: string;
          wilaya_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "onm_vigilance_area_id_fkey";
            columns: ["area_id"];
            isOneToOne: false;
            referencedRelation: "onm_areas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "onm_vigilance_wilaya_id_fkey";
            columns: ["wilaya_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };
      open_areas: {
        Row: {
          area_type: string;
          commune_id: string | null;
          created_at: string;
          id: string;
          lat: number;
          lon: number;
          name: string;
          name_ar: string | null;
          osm_id: number | null;
          osm_type: string | null;
          source: string;
          verified_at: string | null;
          verified_by: string | null;
          verified_note: string | null;
        };
        Insert: {
          area_type: string;
          commune_id?: string | null;
          created_at?: string;
          id?: string;
          lat: number;
          lon: number;
          name: string;
          name_ar?: string | null;
          osm_id?: number | null;
          osm_type?: string | null;
          source?: string;
          verified_at?: string | null;
          verified_by?: string | null;
          verified_note?: string | null;
        };
        Update: {
          area_type?: string;
          commune_id?: string | null;
          created_at?: string;
          id?: string;
          lat?: number;
          lon?: number;
          name?: string;
          name_ar?: string | null;
          osm_id?: number | null;
          osm_type?: string | null;
          source?: string;
          verified_at?: string | null;
          verified_by?: string | null;
          verified_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "open_areas_commune_id_fkey";
            columns: ["commune_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };
      persistent_sources: {
        Row: {
          active_days: number;
          created_at: string;
          detection_count: number;
          first_seen: string;
          frp_p50: number | null;
          frp_p90: number | null;
          id: string;
          jul_aug_share: number | null;
          last_seen: string;
          lat: number;
          lon: number;
          observation_days: number;
          site_id: string;
          site_name: string | null;
          static_share: number;
        };
        Insert: {
          active_days: number;
          created_at?: string;
          detection_count: number;
          first_seen: string;
          frp_p50?: number | null;
          frp_p90?: number | null;
          id?: string;
          jul_aug_share?: number | null;
          last_seen: string;
          lat: number;
          lon: number;
          observation_days: number;
          site_id: string;
          site_name?: string | null;
          static_share: number;
        };
        Update: {
          active_days?: number;
          created_at?: string;
          detection_count?: number;
          first_seen?: string;
          frp_p50?: number | null;
          frp_p90?: number | null;
          id?: string;
          jul_aug_share?: number | null;
          last_seen?: string;
          lat?: number;
          lon?: number;
          observation_days?: number;
          site_id?: string;
          site_name?: string | null;
          static_share?: number;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          alert_email: boolean;
          alert_push: boolean;
          created_at: string;
          display_name: string | null;
          id: string;
          locale: string;
          min_confidence: number;
          min_danger_level: number;
          phone: string | null;
          quiet_hours_end: number | null;
          quiet_hours_start: number | null;
          updated_at: string;
        };
        Insert: {
          alert_email?: boolean;
          alert_push?: boolean;
          created_at?: string;
          display_name?: string | null;
          id: string;
          locale?: string;
          min_confidence?: number;
          min_danger_level?: number;
          phone?: string | null;
          quiet_hours_end?: number | null;
          quiet_hours_start?: number | null;
          updated_at?: string;
        };
        Update: {
          alert_email?: boolean;
          alert_push?: boolean;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          locale?: string;
          min_confidence?: number;
          min_danger_level?: number;
          phone?: string | null;
          quiet_hours_end?: number | null;
          quiet_hours_start?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      report_witnesses: {
        Row: {
          created_at: string;
          report_id: string;
          user_id: string;
          vote: string;
        };
        Insert: {
          created_at?: string;
          report_id: string;
          user_id: string;
          vote: string;
        };
        Update: {
          created_at?: string;
          report_id?: string;
          user_id?: string;
          vote?: string;
        };
        Relationships: [];
      };
      risk_forecasts: {
        Row: {
          commune_id: string;
          components: Json | null;
          created_at: string;
          danger_level: number;
          forecast_date: string;
          fuel_limited: boolean;
          fwi: number;
          fwi_percentile: number | null;
          horizon_days: number;
          id: string;
          snapshot_id: string | null;
          source: string;
        };
        Insert: {
          commune_id: string;
          components?: Json | null;
          created_at?: string;
          danger_level: number;
          forecast_date: string;
          fuel_limited?: boolean;
          fwi: number;
          fwi_percentile?: number | null;
          horizon_days: number;
          id?: string;
          snapshot_id?: string | null;
          source: string;
        };
        Update: {
          commune_id?: string;
          components?: Json | null;
          created_at?: string;
          danger_level?: number;
          forecast_date?: string;
          fuel_limited?: boolean;
          fwi?: number;
          fwi_percentile?: number | null;
          horizon_days?: number;
          id?: string;
          snapshot_id?: string | null;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: "risk_forecasts_commune_id_fkey";
            columns: ["commune_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "risk_forecasts_snapshot_id_fkey";
            columns: ["snapshot_id"];
            isOneToOne: false;
            referencedRelation: "risk_publications";
            referencedColumns: ["snapshot_id"];
          },
        ];
      };
      settlements: {
        Row: {
          commune_id: string | null;
          created_at: string;
          id: string;
          lat: number;
          lon: number;
          name: string;
          name_ar: string | null;
          osm_id: number | null;
          place_type: string;
          population: number | null;
        };
        Insert: {
          commune_id?: string | null;
          created_at?: string;
          id?: string;
          lat: number;
          lon: number;
          name: string;
          name_ar?: string | null;
          osm_id?: number | null;
          place_type?: string;
          population?: number | null;
        };
        Update: {
          commune_id?: string | null;
          created_at?: string;
          id?: string;
          lat?: number;
          lon?: number;
          name?: string;
          name_ar?: string | null;
          osm_id?: number | null;
          place_type?: string;
          population?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "settlements_commune_id_fkey";
            columns: ["commune_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };
      source_checkpoints: {
        Row: {
          consecutive_failures: number;
          contract_key: string;
          coverage_status: string;
          data_from: string | null;
          data_through: string | null;
          fallback_contract_key: string | null;
          last_attempt_at: string | null;
          last_public_reason_code: string | null;
          last_scheduled_for: string | null;
          last_success_at: string | null;
          published_at: string | null;
          records_accepted: number;
          records_expected: number | null;
          replay_cursor: Json | null;
          schema_fingerprint: string | null;
          updated_at: string;
          upstream_published_at: string | null;
          validated_at: string | null;
        };
        Insert: {
          consecutive_failures?: number;
          contract_key: string;
          coverage_status?: string;
          data_from?: string | null;
          data_through?: string | null;
          fallback_contract_key?: string | null;
          last_attempt_at?: string | null;
          last_public_reason_code?: string | null;
          last_scheduled_for?: string | null;
          last_success_at?: string | null;
          published_at?: string | null;
          records_accepted?: number;
          records_expected?: number | null;
          replay_cursor?: Json | null;
          schema_fingerprint?: string | null;
          updated_at?: string;
          upstream_published_at?: string | null;
          validated_at?: string | null;
        };
        Update: {
          consecutive_failures?: number;
          contract_key?: string;
          coverage_status?: string;
          data_from?: string | null;
          data_through?: string | null;
          fallback_contract_key?: string | null;
          last_attempt_at?: string | null;
          last_public_reason_code?: string | null;
          last_scheduled_for?: string | null;
          last_success_at?: string | null;
          published_at?: string | null;
          records_accepted?: number;
          records_expected?: number | null;
          replay_cursor?: Json | null;
          schema_fingerprint?: string | null;
          updated_at?: string;
          upstream_published_at?: string | null;
          validated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "source_checkpoints_contract_key_fkey";
            columns: ["contract_key"];
            isOneToOne: true;
            referencedRelation: "source_contracts";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "source_checkpoints_contract_key_fkey";
            columns: ["contract_key"];
            isOneToOne: true;
            referencedRelation: "source_health";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "source_checkpoints_fallback_contract_key_fkey";
            columns: ["fallback_contract_key"];
            isOneToOne: false;
            referencedRelation: "source_contracts";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "source_checkpoints_fallback_contract_key_fkey";
            columns: ["fallback_contract_key"];
            isOneToOne: false;
            referencedRelation: "source_health";
            referencedColumns: ["key"];
          },
        ];
      };
      source_contracts: {
        Row: {
          attribution: string;
          cadence_minutes: number;
          created_at: string;
          criticality: string;
          dependency_keys: string[];
          enabled: boolean;
          execution_target: string;
          expected_coverage: Json;
          family: string;
          freshness_basis: string;
          key: string;
          label: string;
          lease_seconds: number;
          licence: string;
          max_attempts: number;
          max_fallback_age_minutes: number | null;
          overlap_minutes: number;
          owner: string;
          parser_version: string;
          replay_capability: string;
          replay_window_minutes: number | null;
          retry_base_seconds: number;
          retry_window_minutes: number;
          runbook_url: string | null;
          schedule_enabled: boolean;
          schedule_offset_minutes: number;
          stale_after_minutes: number;
          updated_at: string;
          version: number;
          warning_after_minutes: number;
        };
        Insert: {
          attribution: string;
          cadence_minutes: number;
          created_at?: string;
          criticality: string;
          dependency_keys?: string[];
          enabled?: boolean;
          execution_target?: string;
          expected_coverage?: Json;
          family: string;
          freshness_basis: string;
          key: string;
          label: string;
          lease_seconds?: number;
          licence: string;
          max_attempts?: number;
          max_fallback_age_minutes?: number | null;
          overlap_minutes?: number;
          owner: string;
          parser_version: string;
          replay_capability?: string;
          replay_window_minutes?: number | null;
          retry_base_seconds?: number;
          retry_window_minutes?: number;
          runbook_url?: string | null;
          schedule_enabled?: boolean;
          schedule_offset_minutes?: number;
          stale_after_minutes: number;
          updated_at?: string;
          version: number;
          warning_after_minutes: number;
        };
        Update: {
          attribution?: string;
          cadence_minutes?: number;
          created_at?: string;
          criticality?: string;
          dependency_keys?: string[];
          enabled?: boolean;
          execution_target?: string;
          expected_coverage?: Json;
          family?: string;
          freshness_basis?: string;
          key?: string;
          label?: string;
          lease_seconds?: number;
          licence?: string;
          max_attempts?: number;
          max_fallback_age_minutes?: number | null;
          overlap_minutes?: number;
          owner?: string;
          parser_version?: string;
          replay_capability?: string;
          replay_window_minutes?: number | null;
          retry_base_seconds?: number;
          retry_window_minutes?: number;
          runbook_url?: string | null;
          schedule_enabled?: boolean;
          schedule_offset_minutes?: number;
          stale_after_minutes?: number;
          updated_at?: string;
          version?: number;
          warning_after_minutes?: number;
        };
        Relationships: [];
      };
      source_gaps: {
        Row: {
          contract_key: string;
          data_from: string;
          data_through: string;
          detected_at: string;
          id: string;
          public_reason_code: string | null;
          replay_count: number;
          resolved_at: string | null;
          resolved_by_run_id: string | null;
          state: string;
          updated_at: string;
        };
        Insert: {
          contract_key: string;
          data_from: string;
          data_through: string;
          detected_at?: string;
          id?: string;
          public_reason_code?: string | null;
          replay_count?: number;
          resolved_at?: string | null;
          resolved_by_run_id?: string | null;
          state?: string;
          updated_at?: string;
        };
        Update: {
          contract_key?: string;
          data_from?: string;
          data_through?: string;
          detected_at?: string;
          id?: string;
          public_reason_code?: string | null;
          replay_count?: number;
          resolved_at?: string | null;
          resolved_by_run_id?: string | null;
          state?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "source_gaps_contract_key_fkey";
            columns: ["contract_key"];
            isOneToOne: false;
            referencedRelation: "source_contracts";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "source_gaps_contract_key_fkey";
            columns: ["contract_key"];
            isOneToOne: false;
            referencedRelation: "source_health";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "source_gaps_resolved_by_run_id_fkey";
            columns: ["resolved_by_run_id"];
            isOneToOne: false;
            referencedRelation: "source_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      source_job_leases: {
        Row: {
          attempt: number;
          contract_key: string;
          job_id: string;
          lease_expires_at: string;
          leased_at: string;
          worker_id: string;
        };
        Insert: {
          attempt: number;
          contract_key: string;
          job_id: string;
          lease_expires_at: string;
          leased_at: string;
          worker_id: string;
        };
        Update: {
          attempt?: number;
          contract_key?: string;
          job_id?: string;
          lease_expires_at?: string;
          leased_at?: string;
          worker_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "source_job_leases_contract_key_fkey";
            columns: ["contract_key"];
            isOneToOne: true;
            referencedRelation: "source_contracts";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "source_job_leases_contract_key_fkey";
            columns: ["contract_key"];
            isOneToOne: true;
            referencedRelation: "source_health";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "source_job_leases_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: true;
            referencedRelation: "source_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      source_jobs: {
        Row: {
          attempt_count: number;
          available_at: string;
          contract_key: string;
          contract_version: number;
          created_at: string;
          data_from: string;
          data_through: string;
          dispatched_at: string | null;
          enqueued_by: string[];
          execution_target: string;
          finished_at: string | null;
          gap_id: string | null;
          id: string;
          idempotency_key: string;
          last_error_at: string | null;
          last_public_reason_code: string | null;
          max_attempts: number;
          retry_base_seconds: number;
          retry_until: string;
          scheduled_for: string;
          started_at: string | null;
          state: string;
          trigger_kind: string;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          available_at?: string;
          contract_key: string;
          contract_version: number;
          created_at?: string;
          data_from: string;
          data_through: string;
          dispatched_at?: string | null;
          enqueued_by?: string[];
          execution_target: string;
          finished_at?: string | null;
          gap_id?: string | null;
          id?: string;
          idempotency_key: string;
          last_error_at?: string | null;
          last_public_reason_code?: string | null;
          max_attempts: number;
          retry_base_seconds: number;
          retry_until: string;
          scheduled_for: string;
          started_at?: string | null;
          state?: string;
          trigger_kind: string;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          available_at?: string;
          contract_key?: string;
          contract_version?: number;
          created_at?: string;
          data_from?: string;
          data_through?: string;
          dispatched_at?: string | null;
          enqueued_by?: string[];
          execution_target?: string;
          finished_at?: string | null;
          gap_id?: string | null;
          id?: string;
          idempotency_key?: string;
          last_error_at?: string | null;
          last_public_reason_code?: string | null;
          max_attempts?: number;
          retry_base_seconds?: number;
          retry_until?: string;
          scheduled_for?: string;
          started_at?: string | null;
          state?: string;
          trigger_kind?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "source_jobs_contract_key_fkey";
            columns: ["contract_key"];
            isOneToOne: false;
            referencedRelation: "source_contracts";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "source_jobs_contract_key_fkey";
            columns: ["contract_key"];
            isOneToOne: false;
            referencedRelation: "source_health";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "source_jobs_gap_id_fkey";
            columns: ["gap_id"];
            isOneToOne: false;
            referencedRelation: "source_gaps";
            referencedColumns: ["id"];
          },
        ];
      };
      source_recovery_events: {
        Row: {
          contract_key: string;
          created_at: string;
          from_version: string;
          id: string;
          previous_attempts: number;
          previous_error: string | null;
          subject_id: string;
          to_version: string;
        };
        Insert: {
          contract_key: string;
          created_at?: string;
          from_version: string;
          id?: string;
          previous_attempts: number;
          previous_error?: string | null;
          subject_id: string;
          to_version: string;
        };
        Update: {
          contract_key?: string;
          created_at?: string;
          from_version?: string;
          id?: string;
          previous_attempts?: number;
          previous_error?: string | null;
          subject_id?: string;
          to_version?: string;
        };
        Relationships: [
          {
            foreignKeyName: "source_recovery_events_contract_key_fkey";
            columns: ["contract_key"];
            isOneToOne: false;
            referencedRelation: "source_contracts";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "source_recovery_events_contract_key_fkey";
            columns: ["contract_key"];
            isOneToOne: false;
            referencedRelation: "source_health";
            referencedColumns: ["key"];
          },
        ];
      };
      source_runs: {
        Row: {
          attempt: number | null;
          contract_key: string;
          contract_version: number;
          coverage_status: string;
          created_at: string;
          data_from: string | null;
          data_through: string | null;
          finished_at: string | null;
          id: string;
          idempotency_key: string | null;
          job_id: string | null;
          outcome: string;
          private_diagnostic: string | null;
          public_reason_code: string | null;
          published_at: string | null;
          quality_checks: Json;
          records_expected: number | null;
          records_inserted: number;
          records_rejected: number;
          records_seen: number;
          records_updated: number;
          scheduled_for: string;
          started_at: string;
          trigger_kind: string;
          upstream_published_at: string | null;
          validated_at: string | null;
        };
        Insert: {
          attempt?: number | null;
          contract_key: string;
          contract_version: number;
          coverage_status?: string;
          created_at?: string;
          data_from?: string | null;
          data_through?: string | null;
          finished_at?: string | null;
          id?: string;
          idempotency_key?: string | null;
          job_id?: string | null;
          outcome: string;
          private_diagnostic?: string | null;
          public_reason_code?: string | null;
          published_at?: string | null;
          quality_checks?: Json;
          records_expected?: number | null;
          records_inserted?: number;
          records_rejected?: number;
          records_seen?: number;
          records_updated?: number;
          scheduled_for: string;
          started_at: string;
          trigger_kind: string;
          upstream_published_at?: string | null;
          validated_at?: string | null;
        };
        Update: {
          attempt?: number | null;
          contract_key?: string;
          contract_version?: number;
          coverage_status?: string;
          created_at?: string;
          data_from?: string | null;
          data_through?: string | null;
          finished_at?: string | null;
          id?: string;
          idempotency_key?: string | null;
          job_id?: string | null;
          outcome?: string;
          private_diagnostic?: string | null;
          public_reason_code?: string | null;
          published_at?: string | null;
          quality_checks?: Json;
          records_expected?: number | null;
          records_inserted?: number;
          records_rejected?: number;
          records_seen?: number;
          records_updated?: number;
          scheduled_for?: string;
          started_at?: string;
          trigger_kind?: string;
          upstream_published_at?: string | null;
          validated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "source_runs_contract_key_fkey";
            columns: ["contract_key"];
            isOneToOne: false;
            referencedRelation: "source_contracts";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "source_runs_contract_key_fkey";
            columns: ["contract_key"];
            isOneToOne: false;
            referencedRelation: "source_health";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "source_runs_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "source_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      telegram_channels: {
        Row: {
          chat_id: string;
          created_at: string;
          wilaya_id: string;
        };
        Insert: {
          chat_id: string;
          created_at?: string;
          wilaya_id: string;
        };
        Update: {
          chat_id?: string;
          created_at?: string;
          wilaya_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "telegram_channels_wilaya_id_fkey";
            columns: ["wilaya_id"];
            isOneToOne: true;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };
      translation_suggestions: {
        Row: {
          created_at: string;
          current_text: string;
          id: string;
          key_path: string;
          locale: string;
          moderated_by: string | null;
          moderation_note: string | null;
          note: string | null;
          reviewer_key: string;
          reviewer_name: string | null;
          source_text: string;
          status: string;
          suggestion: string | null;
          verdict: string;
        };
        Insert: {
          created_at?: string;
          current_text: string;
          id?: string;
          key_path: string;
          locale: string;
          moderated_by?: string | null;
          moderation_note?: string | null;
          note?: string | null;
          reviewer_key: string;
          reviewer_name?: string | null;
          source_text: string;
          status?: string;
          suggestion?: string | null;
          verdict: string;
        };
        Update: {
          created_at?: string;
          current_text?: string;
          id?: string;
          key_path?: string;
          locale?: string;
          moderated_by?: string | null;
          moderation_note?: string | null;
          note?: string | null;
          reviewer_key?: string;
          reviewer_name?: string | null;
          source_text?: string;
          status?: string;
          suggestion?: string | null;
          verdict?: string;
        };
        Relationships: [];
      };
      user_push_devices: {
        Row: {
          device_hash: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          device_hash: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          device_hash?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      webhook_deliveries: {
        Row: {
          alert_id: string | null;
          created_at: string;
          endpoint_id: string;
          error: string | null;
          id: string;
          ok: boolean;
          status_code: number | null;
          user_id: string;
        };
        Insert: {
          alert_id?: string | null;
          created_at?: string;
          endpoint_id: string;
          error?: string | null;
          id?: string;
          ok?: boolean;
          status_code?: number | null;
          user_id: string;
        };
        Update: {
          alert_id?: string | null;
          created_at?: string;
          endpoint_id?: string;
          error?: string | null;
          id?: string;
          ok?: boolean;
          status_code?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_alert_id_fkey";
            columns: ["alert_id"];
            isOneToOne: false;
            referencedRelation: "alerts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "webhook_deliveries_endpoint_id_fkey";
            columns: ["endpoint_id"];
            isOneToOne: false;
            referencedRelation: "webhook_endpoints";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_endpoints: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          kinds: string[];
          label: string;
          last_attempt_at: string | null;
          last_error: string | null;
          last_status: number | null;
          min_severity: number;
          secret: string;
          updated_at: string;
          url: string;
          user_id: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          kinds?: string[];
          label: string;
          last_attempt_at?: string | null;
          last_error?: string | null;
          last_status?: number | null;
          min_severity?: number;
          secret?: string;
          updated_at?: string;
          url: string;
          user_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          kinds?: string[];
          label?: string;
          last_attempt_at?: string | null;
          last_error?: string | null;
          last_status?: number | null;
          min_severity?: number;
          secret?: string;
          updated_at?: string;
          url?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      zones: {
        Row: {
          active: boolean;
          commune_id: string | null;
          created_at: string;
          id: string;
          lat: number;
          lon: number;
          min_danger_level: number;
          name: string;
          notify_citizen: boolean;
          notify_earthquake: boolean;
          notify_fires: boolean;
          notify_official: boolean;
          notify_risk: boolean;
          notify_road: boolean;
          notify_weather: boolean;
          radius_km: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          active?: boolean;
          commune_id?: string | null;
          created_at?: string;
          id?: string;
          lat: number;
          lon: number;
          min_danger_level?: number;
          name: string;
          notify_citizen?: boolean;
          notify_earthquake?: boolean;
          notify_fires?: boolean;
          notify_official?: boolean;
          notify_risk?: boolean;
          notify_road?: boolean;
          notify_weather?: boolean;
          radius_km?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          active?: boolean;
          commune_id?: string | null;
          created_at?: string;
          id?: string;
          lat?: number;
          lon?: number;
          min_danger_level?: number;
          name?: string;
          notify_citizen?: boolean;
          notify_earthquake?: boolean;
          notify_fires?: boolean;
          notify_official?: boolean;
          notify_risk?: boolean;
          notify_road?: boolean;
          notify_weather?: boolean;
          radius_km?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "zones_commune_id_fkey";
            columns: ["commune_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };

      risk_forecast_snapshot_runs: {
        Row: {
          base_date: string;
          created_at: string;
          finished_at: string | null;
          heartbeat_at: string;
          scheduled_for: string;
          snapshot_id: string;
          status: string;
        };
        Insert: {
          base_date: string;
          created_at?: string;
          finished_at?: string | null;
          heartbeat_at?: string;
          scheduled_for: string;
          snapshot_id: string;
          status?: string;
        };
        Update: {
          base_date?: string;
          created_at?: string;
          finished_at?: string | null;
          heartbeat_at?: string;
          scheduled_for?: string;
          snapshot_id?: string;
          status?: string;
        };
        Relationships: [];
      };
      risk_forecast_staging: {
        Row: {
          commune_id: string;
          components: Json | null;
          danger_level: number;
          forecast_date: string;
          fuel_limited: boolean;
          fwi: number;
          fwi_percentile: number | null;
          horizon_days: number;
          snapshot_id: string;
          staged_at: string;
        };
        Insert: {
          commune_id: string;
          components?: Json | null;
          danger_level: number;
          forecast_date: string;
          fuel_limited?: boolean;
          fwi: number;
          fwi_percentile?: number | null;
          horizon_days: number;
          snapshot_id: string;
          staged_at?: string;
        };
        Update: {
          commune_id?: string;
          components?: Json | null;
          danger_level?: number;
          forecast_date?: string;
          fuel_limited?: boolean;
          fwi?: number;
          fwi_percentile?: number | null;
          horizon_days?: number;
          snapshot_id?: string;
          staged_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "risk_forecast_staging_commune_id_fkey";
            columns: ["commune_id"];
            isOneToOne: false;
            referencedRelation: "admin_units";
            referencedColumns: ["id"];
          },
        ];
      };
      risk_publication_checkpoint: {
        Row: {
          base_date: string;
          coverage_status: string;
          key: string;
          published_at: string;
          scheduled_for: string;
          snapshot_id: string;
        };
        Insert: {
          base_date: string;
          coverage_status?: string;
          key: string;
          published_at: string;
          scheduled_for: string;
          snapshot_id: string;
        };
        Update: {
          base_date?: string;
          coverage_status?: string;
          key?: string;
          published_at?: string;
          scheduled_for?: string;
          snapshot_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "risk_publication_checkpoint_snapshot_id_fkey";
            columns: ["snapshot_id"];
            isOneToOne: false;
            referencedRelation: "risk_publications";
            referencedColumns: ["snapshot_id"];
          },
        ];
      };
      risk_publications: {
        Row: {
          base_date: string;
          published_at: string;
          row_count: number;
          scheduled_for: string;
          snapshot_id: string;
        };
        Insert: {
          base_date: string;
          published_at: string;
          row_count: number;
          scheduled_for: string;
          snapshot_id: string;
        };
        Update: {
          base_date?: string;
          published_at?: string;
          row_count?: number;
          scheduled_for?: string;
          snapshot_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      hazard_history: {
        Row: {
          area_ha: number | null;
          at: string | null;
          event: string | null;
          hazard: string | null;
          id: string | null;
          severity: string | null;
          short_id: string | null;
          state: string | null;
          summary: string | null;
          wilaya_id: string | null;
        };
        Relationships: [];
      };
      airport_weather: {
        Row: {
          fetched_at: string | null;
          gust_kt: number | null;
          lat: number | null;
          lon: number | null;
          name: string | null;
          observed_at: string | null;
          raw: string | null;
          station: string | null;
          temp_c: number | null;
          visibility_m: number | null;
          weather: string | null;
          wind_kt: number | null;
        };
        Relationships: [];
      };
      onm_wilaya_outlines: {
        Row: {
          polygon: Json | null;
          wilaya_id: string | null;
        };
        Relationships: [];
      };
      delivery_queue_health: {
        Row: {
          channel: string | null;
          expired_count: number | null;
          oldest_pending_at: string | null;
          paused: boolean | null;
          pending_count: number | null;
        };
        Relationships: [];
      };
      admin_audit_timeline: {
        Row: {
          action: string | null;
          actor_kind: string | null;
          actor_label: string | null;
          actor_user_id: string | null;
          after: Json | null;
          at: string | null;
          before: Json | null;
          domain: string | null;
          id: string | null;
          reason: string | null;
          target_id: string | null;
          target_table: string | null;
        };
        Relationships: [];
      };
      hazard_reports: {
        Row: {
          commune_id: string | null;
          created_at: string | null;
          expires_at: string | null;
          hazard: string | null;
          id: string | null;
          kind: string | null;
          lat: number | null;
          lon: number | null;
          observed_at: string | null;
          sighting: string | null;
          status: string | null;
          summary: string | null;
          witnesses: number | null;
        };
        Insert: {
          commune_id?: string | null;
          created_at?: string | null;
          expires_at?: string | null;
          hazard?: string | null;
          id?: string | null;
          kind?: string | null;
          lat?: number | null;
          lon?: number | null;
          observed_at?: string | null;
          sighting?: string | null;
          status?: string | null;
          summary?: string | null;
          witnesses?: number | null;
        };
        Update: {
          commune_id?: string | null;
          created_at?: string | null;
          expires_at?: string | null;
          hazard?: string | null;
          id?: string | null;
          kind?: string | null;
          lat?: number | null;
          lon?: number | null;
          observed_at?: string | null;
          sighting?: string | null;
          status?: string | null;
          summary?: string | null;
          witnesses?: number | null;
        };
        Relationships: [];
      };
      official_incident_recall_daily: {
        Row: {
          communes: number | null;
          day: string | null;
          mentions: number | null;
          with_cluster: number | null;
        };
        Relationships: [];
      };
      onm_warning_history: {
        Row: {
          event: string | null;
          expires: string | null;
          id: string | null;
          severity: string | null;
          starts_at: string | null;
          wilaya_id: string | null;
        };
        Relationships: [];
      };
      source_health: {
        Row: {
          age_minutes: number | null;
          coverage_status: string | null;
          criticality: string | null;
          fallback_contract_key: string | null;
          family: string | null;
          freshness_basis: string | null;
          key: string | null;
          label: string | null;
          last_attempt_at: string | null;
          last_success_at: string | null;
          public_reason_code: string | null;
          published_at: string | null;
          records_accepted: number | null;
          records_expected: number | null;
          stale_after_minutes: number | null;
          state: string | null;
          valid_at: string | null;
          warning_after_minutes: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "source_checkpoints_fallback_contract_key_fkey";
            columns: ["fallback_contract_key"];
            isOneToOne: false;
            referencedRelation: "source_contracts";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "source_checkpoints_fallback_contract_key_fkey";
            columns: ["fallback_contract_key"];
            isOneToOne: false;
            referencedRelation: "source_health";
            referencedColumns: ["key"];
          },
        ];
      };
      source_watchdog: {
        Row: {
          contract_key: string | null;
          issue_code: string | null;
          job_id: string | null;
          lease_expires_at: string | null;
          observed_at: string | null;
          scheduled_for: string | null;
        };
        Relationships: [];
      };

      published_contribution_ideas: {
        Row: {
          id: string | null;
          lane: string | null;
          message: string | null;
          published_at: string | null;
          score: number | null;
        };
        Insert: {
          id?: string | null;
          lane?: string | null;
          message?: string | null;
          published_at?: string | null;
          score?: number | null;
        };
        Update: {
          id?: string | null;
          lane?: string | null;
          message?: string | null;
          published_at?: string | null;
          score?: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      hazard_history_summary: {
        Args: {
          _hazard?: string;
          _now?: string;
          _official_kinds?: string[];
          _wilaya?: string;
          _year?: number;
        };
        Returns: Json;
      };
      translation_queue_counts: { Args: never; Returns: Json };
      idea_queue_counts: { Args: never; Returns: Json };
      member_counts_for_admin: { Args: never; Returns: Json };
      list_members_page: {
        Args: {
          _limit?: number;
          _offset?: number;
          _role?: string;
          _search?: string;
          _sort?: string;
        };
        Returns: {
          created_at: string;
          display_name: string;
          email: string;
          id: string;
          last_sign_in_at: string;
          locale: string;
          matching: number;
          report_count: number;
          roles: Database["public"]["Enums"]["app_role"][];
          zone_count: number;
        }[];
      };
      onm_suppressions_logged: { Args: { _ids: string[] }; Returns: string[] };
      store_onm_detail: {
        Args: {
          _headline_fr?: string;
          _id: string;
          _instruction_fr?: string;
          _polygon?: Json;
        };
        Returns: undefined;
      };
      cold_pending_days: { Args: { _table: string }; Returns: string[] };
      cold_archive_commit: {
        Args: {
          _bytes?: number;
          _day: string;
          _key_digest?: string;
          _path?: string;
          _rows: number;
          _sha256?: string;
          _table: string;
        };
        Returns: number;
      };
      admin_push_delivery: {
        Args: { _days?: number };
        Returns: {
          day: string;
          failed: number;
          no_device: number;
          received: number;
          sent: number;
        }[];
      };
      supersede_onm_absent: {
        Args: { _feed_cap_ids: string[]; _feed_sent: string };
        Returns: number;
      };
      search_civil_official_evidence: {
        Args: { _query?: string | null; _area?: string | null };
        Returns: {
          id: string;
          mention_id: string;
          evidence: string;
          status: string;
          as_of: string;
          kind: string;
          place_text: string | null;
          wilaya_id: string;
          commune_id: string | null;
          source_url: string;
          source_published_at: string;
        }[];
      };
      finish_civil_investigation: {
        Args: {
          _attempt: number;
          _error: string | null;
          _id: string;
          _investigation_attempt: number;
          _job: string;
          _result: Json;
        };
        Returns: undefined;
      };
      claim_civil_investigations: {
        Args: { _attempt: number; _job: string; _limit?: number };
        Returns: {
          attempts: number;
          error: string | null;
          failures: number;
          id: string;
          incident_index: number;
          job_attempt: number | null;
          job_id: string | null;
          next_attempt_at: string;
          report_id: string;
          state: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "civil_investigations";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      publish_ita_publication: {
        Args: {
          _area_id: string;
          _expires_at: string;
          _hazard: string;
          _incident_index: number;
          _reason: string;
          _report_id: string;
          _summary: string;
        };
        Returns: {
          area_id: string;
          cap_references: Json;
          expires_at: string;
          hazard: string;
          id: string;
          incident_index: number;
          ita_report_id: string;
          published_at: string;
          revision: number;
          source_name: string;
          source_published_at: string;
          source_url: string;
          state: string;
          summary: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "civil_publications";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      revise_civil_publication: {
        Args: {
          _action: string;
          _expected_revision: number;
          _id: string;
          _patch: Json;
          _reason: string;
        };
        Returns: {
          area_id: string;
          cap_references: Json;
          expires_at: string;
          hazard: string;
          id: string;
          incident_index: number;
          ita_report_id: string;
          published_at: string;
          revision: number;
          source_name: string;
          source_published_at: string;
          source_url: string;
          state: string;
          summary: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "civil_publications";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      retry_text_document: { Args: { _id: string }; Returns: undefined };
      prepare_source_recovery: {
        Args: {
          _attempt: number;
          _job: string;
          _key: string;
          _parser_version?: string;
        };
        Returns: number;
      };
      source_processing_health: {
        Args: never;
        Returns: {
          collection_at: string;
          key: string;
          pending: number;
          quarantined: number;
        }[];
      };
      current_weather_snapshot: {
        Args: { _commune_id: string };
        Returns: Json;
      };
      save_weather_snapshots: {
        Args: { _job: string; _attempt: number; _snapshots: Json };
        Returns: number;
      };
      write_text_source: {
        Args: {
          _attempt?: number | null;
          _job?: string | null;
          _key: string;
          _operation: string;
          _payload: Json;
        };
        Returns: Json;
      };
      retry_ita_report: { Args: { _id: string }; Returns: undefined };
      finish_webhook_delivery: {
        Args: {
          _error: string | null;
          _id: string;
          _status: number | null;
          _token: string;
        };
        Returns: boolean;
      };
      claim_webhook_delivery: {
        Args: never;
        Returns: {
          id: string;
          lease_token: string;
          payload: Json;
          secret: string;
          url: string;
        }[];
      };
      assert_ita_source_lease: {
        Args: { _attempt: number; _job: string };
        Returns: undefined;
      };
      claim_ita_extractions: {
        Args: { _attempt: number; _job: string; _limit?: number };
        Returns: {
          body: string;
          content_hash: string;
          extracted_at: string | null;
          extraction: Json | null;
          extraction_attempts: number;
          extraction_error: string | null;
          extraction_requeued_at: string | null;
          fetched_at: string;
          id: string;
          next_extraction_at: string;
          published_at: string;
          raw: Json;
          recovery_version: string;
          source_page: string;
          source_post_id: string;
          source_url: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "ita_reports";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      finish_ita_extraction: {
        Args: {
          _attempt: number;
          _error: string | null;
          _extraction: Json;
          _id: string;
          _job: string;
        };
        Returns: undefined;
      };
      release_ita_extraction: {
        Args: { _attempt: number; _id: string; _job: string };
        Returns: undefined;
      };
      save_ita_facebook_posts: {
        Args: { _attempt: number; _job: string; _posts: Json };
        Returns: number;
      };
      save_ita_feed: {
        Args: {
          _attempt: number;
          _etag: string | null;
          _job: string;
          _not_modified: boolean;
          _posts: Json;
        };
        Returns: number;
      };

      set_source_paused: {
        Args: { _key: string; _paused: boolean; _reason?: string | null };
        Returns: undefined;
      };
      acknowledge_operational_incident: {
        Args: { _id: string };
        Returns: undefined;
      };
      claim_broadcast_delivery: {
        Args: { _channel: string; _limit?: number };
        Returns: {
          job: Json;
        }[];
      };
      finish_broadcast_delivery: {
        Args: {
          _broadcast_id: string;
          _channel: string;
          _count: number | null;
          _error?: string | null;
          _lease_token: string;
        };
        Returns: boolean;
      };
      refresh_operational_incidents: { Args: never; Returns: undefined };
      renew_broadcast_delivery: {
        Args: { _broadcast_id: string; _channel: string; _lease_token: string };
        Returns: boolean;
      };
      set_delivery_channel_paused: {
        Args: { _channel: string; _paused: boolean; _reason?: string | null };
        Returns: undefined;
      };
      bump_official_incident: {
        Args: { _id: string; _patch: Json };
        Returns: undefined;
      };
      claim_source_job: {
        Args: {
          _contract_key?: string;
          _execution_target: string;
          _now?: string;
          _worker_id: string;
        };
        Returns: {
          attempt_count: number;
          available_at: string;
          contract_key: string;
          contract_version: number;
          created_at: string;
          data_from: string;
          data_through: string;
          dispatched_at: string | null;
          enqueued_by: string[];
          execution_target: string;
          finished_at: string | null;
          gap_id: string | null;
          id: string;
          idempotency_key: string;
          last_error_at: string | null;
          last_public_reason_code: string | null;
          max_attempts: number;
          retry_base_seconds: number;
          retry_until: string;
          scheduled_for: string;
          started_at: string | null;
          state: string;
          trigger_kind: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "source_jobs";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      complete_source_job: {
        Args: {
          _attempt: number;
          _coverage_status: string;
          _data_from: string | null;
          _data_through: string | null;
          _finished_at: string;
          _job_id: string;
          _outcome: string;
          _private_diagnostic: string | null;
          _public_reason_code: string | null;
          _published_at: string | null;
          _quality_checks: Json;
          _records_expected: number | null;
          _records_inserted: number;
          _records_rejected: number;
          _records_seen: number;
          _records_updated: number;
          _retryable: boolean;
          _upstream_published_at: string | null;
          _validated_at: string | null;
          _worker_id: string;
        };
        Returns: {
          attempt_count: number;
          available_at: string;
          contract_key: string;
          contract_version: number;
          created_at: string;
          data_from: string;
          data_through: string;
          dispatched_at: string | null;
          enqueued_by: string[];
          execution_target: string;
          finished_at: string | null;
          gap_id: string | null;
          id: string;
          idempotency_key: string;
          last_error_at: string | null;
          last_public_reason_code: string | null;
          max_attempts: number;
          retry_base_seconds: number;
          retry_until: string;
          scheduled_for: string;
          started_at: string | null;
          state: string;
          trigger_kind: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "source_jobs";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      consume_rate_limit: {
        Args: { _bucket: string; _limit: number; _window_seconds: number };
        Returns: boolean;
      };
      enqueue_due_source_jobs: {
        Args: { _enqueued_by: string; _observed_at: string };
        Returns: number;
      };
      enqueue_source_replay: {
        Args: { _gap_id: string; _requested_at?: string };
        Returns: string | null;
      };
      grant_user_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user: string;
        };
        Returns: undefined;
      };
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][];
          _user_id: string;
        };
        Returns: boolean;
      };
      record_admin_audit: {
        Args: {
          _action: string;
          _actor_label?: string | null;
          _after?: Json | null;
          _before?: Json | null;
          _domain: string;
          _reason?: string | null;
          _target_id?: string | null;
          _target_table: string;
        };
        Returns: string;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      reply_to_contribution_idea: {
        Args: {
          _actor_label?: string | null;
          _author_kind: string;
          _idea: string;
          _reply: string;
        };
        Returns: undefined;
      };
      replay_source_gap: {
        Args: { _gap_id: string; _reason?: string | null };
        Returns: string;
      };
      claim_alert_pushes: {
        Args: { _limit?: number };
        Returns: Database["public"]["Tables"]["alerts"]["Row"][];
      };
      admin_attention_counts: {
        Args: never;
        Returns: {
          count: number;
          item: string;
          oldest: string | null;
        }[];
      };
      dismiss_civil_investigation: {
        Args: { _id: string; _reason: string };
        Returns: undefined;
      };
      list_risk_snapshot_runs: {
        Args: never;
        Returns: {
          base_date: string;
          created_at: string;
          finished_at: string | null;
          heartbeat_at: string;
          scheduled_for: string;
          snapshot_id: string;
          status: string;
        }[];
      };
      my_contribution: {
        Args: never;
        Returns: Json;
      };
      witness_report: {
        Args: {
          _lat: number;
          _lon: number;
          _report: string;
          _vote: string;
        };
        Returns: number;
      };
      flag_citizen_report: {
        Args: { _reason: string; _report: string };
        Returns: undefined;
      };
      block_report_author: {
        Args: { _report: string };
        Returns: undefined;
      };
      block_reporter: {
        Args: { _reason: string | null; _report: string };
        Returns: undefined;
      };
      citizen_report_flag_summary: {
        Args: { _report: string };
        Returns: {
          flags: number;
          reason: string;
        }[];
      };
      moderate_citizen_report: {
        Args: {
          _cluster: string | null;
          _id: string;
          _note?: string | null;
          _status: string;
        };
        Returns: undefined;
      };
      relay_authority_warning: {
        Args: {
          _body: string;
          _received_via: string;
          _severity: string;
          _source: string;
          _wilaya: string;
        };
        Returns: string;
      };
      resolve_fire: {
        Args: {
          _cluster: string;
          _expected_updated_at?: string | null;
          _actor_label?: string | null;
          _note?: string | null;
          _reason?: string | null;
          _state: string;
        };
        Returns: undefined;
      };
      revoke_user_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user: string;
        };
        Returns: undefined;
      };
      record_source_run: {
        Args: {
          _contract_key: string;
          _coverage_status: string;
          _data_from: string | null;
          _data_through: string | null;
          _finished_at: string;
          _idempotency_key: string;
          _outcome: string;
          _private_diagnostic: string | null;
          _public_reason_code: string | null;
          _published_at: string | null;
          _quality_checks: Json;
          _records_expected: number | null;
          _records_inserted: number;
          _records_rejected: number;
          _records_seen: number;
          _records_updated: number;
          _scheduled_for: string;
          _started_at: string;
          _trigger_kind: string;
          _upstream_published_at: string | null;
          _validated_at: string | null;
        };
        Returns: string;
      };
      source_contract_is_backfilling: {
        Args: { _contract_key: string };
        Returns: boolean;
      };
      source_job_queue_has_pending: {
        Args: {
          _contract_key?: string;
          _execution_target: string;
          _now?: string;
        };
        Returns: boolean;
      };
      verify_open_area: {
        Args: { _area: string; _note?: string | null; _verified?: boolean };
        Returns: undefined;
      };
      vote_on_idea: {
        Args: { _idea: string; _value: number; _voter: string };
        Returns: number;
      };

      begin_risk_forecast_snapshot: {
        Args: {
          _base_date: string;
          _scheduled_for: string;
          _snapshot_id: string;
          _stale_before: string;
        };
        Returns: number;
      };
      current_risk_forecasts: {
        Args: never;
        Returns: {
          admin_level: string;
          commune_code: string;
          commune_id: string;
          components: Json;
          created_at: string;
          danger_level: number;
          forecast_date: string;
          fuel_limited: boolean;
          fwi: number;
          fwi_percentile: number | null;
          horizon_days: number;
          id: string;
          name_ar: string;
          name_en: string;
          name_fr: string;
          snapshot_id: string;
          source: string;
        }[];
      };
      discard_risk_forecast_snapshot: {
        Args: {
          _base_date: string;
          _scheduled_for: string;
          _snapshot_id: string;
        };
        Returns: boolean;
      };
      list_contribution_ideas_for_moderation: {
        Args: { _limit?: number; _offset?: number; _status?: string };
        Returns: {
          contact: string | null;
          created_at: string;
          id: string;
          lane: string;
          locale: string;
          message: string;
          moderated_by: string | null;
          moderation_note: string | null;
          published_at: string | null;
          replied_at: string | null;
          replied_by: string | null;
          reply: string | null;
          reply_author_kind: string | null;
          score: number;
          status: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "contribution_ideas";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      list_members_for_admin: {
        Args: Record<PropertyKey, never>;
        Returns: {
          created_at: string;
          display_name: string | null;
          email: string;
          id: string;
          last_sign_in_at: string | null;
          locale: string;
          report_count: number;
          roles: Database["public"]["Enums"]["app_role"][];
          zone_count: number;
        }[];
      };
      member_detail_for_admin: {
        Args: { _user: string };
        Returns: Json;
      };
      list_translation_suggestions_for_moderation: {
        Args: {
          _limit?: number;
          _locale?: string;
          _offset?: number;
          _status?: string;
        };
        Returns: {
          created_at: string;
          current_text: string;
          id: string;
          key_path: string;
          locale: string;
          moderated_by: string | null;
          moderation_note: string | null;
          note: string | null;
          reviewer_key: string;
          reviewer_name: string | null;
          source_text: string;
          status: string;
          suggestion: string | null;
          verdict: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "translation_suggestions";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      moderate_contribution_idea: {
        Args: { _idea: string; _moderation_note?: string; _status: string };
        Returns: undefined;
      };
      moderate_translation_suggestion: {
        Args: {
          _moderation_note?: string;
          _status: string;
          _suggestion: string;
        };
        Returns: undefined;
      };
      operator_discard_risk_snapshot: {
        Args: {
          _base_date: string;
          _reason: string;
          _scheduled_for: string;
          _snapshot_id: string;
        };
        Returns: boolean;
      };
      operator_edit_incident: {
        Args: { _id: string; _patch: Json; _reason?: string | null };
        Returns: undefined;
      };
      operator_publish_risk_snapshot: {
        Args: {
          _base_date: string;
          _reason?: string | null;
          _scheduled_for: string;
          _snapshot_id: string;
        };
        Returns: Json;
      };
      publish_risk_forecast_snapshot: {
        Args: {
          _base_date: string;
          _scheduled_for: string;
          _snapshot_id: string;
        };
        Returns: Json;
      };
      set_broadcast_enabled: {
        Args: { _enabled: boolean; _note?: string | null };
        Returns: Json;
      };
      stage_risk_forecast_batch: {
        Args: { _rows: Json; _snapshot_id: string };
        Returns: number;
      };
    };
    Enums: {
      app_role:
        | "admin"
        | "moderator"
        | "user"
        | "operator"
        | "report_moderator"
        | "translator"
        | "incident_editor";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "admin",
        "moderator",
        "user",
        "operator",
        "report_moderator",
        "translator",
        "incident_editor",
      ],
    },
  },
} as const;
