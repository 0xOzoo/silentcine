export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      session_listeners: {
        Row: {
          connected_at: string
          id: string
          last_ping_at: string
          listener_token: string
          session_id: string
        }
        Insert: {
          connected_at?: string
          id?: string
          last_ping_at?: string
          listener_token: string
          session_id: string
        }
        Update: {
          connected_at?: string
          id?: string
          last_ping_at?: string
          listener_token?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_listeners_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_listeners_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions_public"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          audio_filename: string | null
          audio_tracks: Json | null
          audio_url: string | null
          code: string
          created_at: string
          current_time_ms: number
          expires_at: string
          host_id: string | null
          host_token: string | null
          id: string
          is_playing: boolean
          last_sync_at: string
          selected_audio_track: number | null
          selected_subtitle_track: number | null
          subtitle_tracks: Json | null
          title: string | null
          updated_at: string
          video_url: string | null
        }
        Insert: {
          audio_filename?: string | null
          audio_tracks?: Json | null
          audio_url?: string | null
          code: string
          created_at?: string
          current_time_ms?: number
          expires_at?: string
          host_id?: string | null
          host_token?: string | null
          id?: string
          is_playing?: boolean
          last_sync_at?: string
          selected_audio_track?: number | null
          selected_subtitle_track?: number | null
          subtitle_tracks?: Json | null
          title?: string | null
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          audio_filename?: string | null
          audio_tracks?: Json | null
          audio_url?: string | null
          code?: string
          created_at?: string
          current_time_ms?: number
          expires_at?: string
          host_id?: string | null
          host_token?: string | null
          id?: string
          is_playing?: boolean
          last_sync_at?: string
          selected_audio_track?: number | null
          selected_subtitle_track?: number | null
          subtitle_tracks?: Json | null
          title?: string | null
          updated_at?: string
          video_url?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      session_listeners_public: {
        Row: {
          connected_at: string | null
          id: string | null
          last_ping_at: string | null
          session_id: string | null
        }
        Insert: {
          connected_at?: string | null
          id?: string | null
          last_ping_at?: string | null
          session_id?: string | null
        }
        Update: {
          connected_at?: string | null
          id?: string | null
          last_ping_at?: string | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_listeners_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_listeners_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions_public"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions_public: {
        Row: {
          audio_filename: string | null
          audio_tracks: Json | null
          audio_url: string | null
          code: string | null
          created_at: string | null
          current_time_ms: number | null
          expires_at: string | null
          host_id: string | null
          id: string | null
          is_playing: boolean | null
          last_sync_at: string | null
          selected_audio_track: number | null
          selected_subtitle_track: number | null
          subtitle_tracks: Json | null
          title: string | null
          updated_at: string | null
          video_url: string | null
        }
        Insert: {
          audio_filename?: string | null
          audio_tracks?: Json | null
          audio_url?: string | null
          code?: string | null
          created_at?: string | null
          current_time_ms?: number | null
          expires_at?: string | null
          host_id?: string | null
          id?: string | null
          is_playing?: boolean | null
          last_sync_at?: string | null
          selected_audio_track?: number | null
          selected_subtitle_track?: number | null
          subtitle_tracks?: Json | null
          title?: string | null
          updated_at?: string | null
          video_url?: string | null
        }
        Update: {
          audio_filename?: string | null
          audio_tracks?: Json | null
          audio_url?: string | null
          code?: string | null
          created_at?: string | null
          current_time_ms?: number | null
          expires_at?: string | null
          host_id?: string | null
          id?: string | null
          is_playing?: boolean | null
          last_sync_at?: string | null
          selected_audio_track?: number | null
          selected_subtitle_track?: number | null
          subtitle_tracks?: Json | null
          title?: string | null
          updated_at?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      generate_session_code: { Args: never; Returns: string }
      get_listener_token: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
