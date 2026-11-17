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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      cash_sessions: {
        Row: {
          closed_at: string | null
          closing_cash_cents: number | null
          club_id: string
          created_at: string
          id: string
          notes: string | null
          opened_at: string
          opening_cash_cents: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          closed_at?: string | null
          closing_cash_cents?: number | null
          club_id: string
          created_at?: string
          id?: string
          notes?: string | null
          opened_at?: string
          opening_cash_cents?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          closed_at?: string | null
          closing_cash_cents?: number | null
          club_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          opened_at?: string
          opening_cash_cents?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      check_ins: {
        Row: {
          club_id: string
          created_at: string
          direction: string
          id: string
          member_id: string
          scanned_by: string | null
        }
        Insert: {
          club_id: string
          created_at?: string
          direction: string
          id?: string
          member_id: string
          scanned_by?: string | null
        }
        Update: {
          club_id?: string
          created_at?: string
          direction?: string
          id?: string
          member_id?: string
          scanned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      club_member_field_config: {
        Row: {
          club_id: string
          created_at: string
          field_key: string
          id: string
          required: boolean
          sort_order: number
          updated_at: string
          visible: boolean
        }
        Insert: {
          club_id: string
          created_at?: string
          field_key: string
          id?: string
          required?: boolean
          sort_order?: number
          updated_at?: string
          visible?: boolean
        }
        Update: {
          club_id?: string
          created_at?: string
          field_key?: string
          id?: string
          required?: boolean
          sort_order?: number
          updated_at?: string
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "club_member_field_config_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      clubs: {
        Row: {
          active: boolean
          city: string | null
          created_at: string
          id: string
          logo_url: string | null
          name: string
          next_member_number: number
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          city?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          next_member_number?: number
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          city?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          next_member_number?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      members: {
        Row: {
          address: string | null
          birth_date: string
          city: string | null
          club_id: string
          contract_signed_at: string | null
          contract_version: string
          created_at: string
          created_by: string | null
          dni_number: string
          dni_photo_path: string | null
          email: string | null
          expires_at: string
          first_name: string
          id: string
          joined_at: string
          last_name: string
          member_number: string
          notes: string | null
          phone: string | null
          plan_id: string | null
          postal_code: string | null
          signature_path: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          birth_date: string
          city?: string | null
          club_id: string
          contract_signed_at?: string | null
          contract_version?: string
          created_at?: string
          created_by?: string | null
          dni_number: string
          dni_photo_path?: string | null
          email?: string | null
          expires_at: string
          first_name: string
          id?: string
          joined_at?: string
          last_name: string
          member_number?: string
          notes?: string | null
          phone?: string | null
          plan_id?: string | null
          postal_code?: string | null
          signature_path?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          birth_date?: string
          city?: string | null
          club_id?: string
          contract_signed_at?: string | null
          contract_version?: string
          created_at?: string
          created_by?: string | null
          dni_number?: string
          dni_photo_path?: string | null
          email?: string | null
          expires_at?: string
          first_name?: string
          id?: string
          joined_at?: string
          last_name?: string
          member_number?: string
          notes?: string | null
          phone?: string | null
          plan_id?: string | null
          postal_code?: string | null
          signature_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "membership_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_plans: {
        Row: {
          active: boolean
          club_id: string
          created_at: string
          duration_days: number
          id: string
          name: string
          price_cents: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          club_id: string
          created_at?: string
          duration_days: number
          id?: string
          name: string
          price_cents: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          club_id?: string
          created_at?: string
          duration_days?: number
          id?: string
          name?: string
          price_cents?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_plans_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          club_id: string
          created_at: string
          id: string
          line_total_cents: number
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          unit_price_cents: number
          unit_type: string
        }
        Insert: {
          club_id: string
          created_at?: string
          id?: string
          line_total_cents: number
          order_id: string
          product_id?: string | null
          product_name: string
          quantity: number
          unit_price_cents: number
          unit_type: string
        }
        Update: {
          club_id?: string
          created_at?: string
          id?: string
          line_total_cents?: number
          order_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          unit_price_cents?: number
          unit_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cash_session_id: string | null
          club_id: string
          created_at: string
          created_by: string | null
          id: string
          member_id: string
          notes: string | null
          status: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          cash_session_id?: string | null
          club_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          member_id: string
          notes?: string | null
          status?: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          cash_session_id?: string | null
          club_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          member_id?: string
          notes?: string | null
          status?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          club_id: string
          created_at: string
          id: string
          is_smokeable: boolean
          name: string
          unit_type: Database["public"]["Enums"]["product_unit"]
          updated_at: string
        }
        Insert: {
          club_id: string
          created_at?: string
          id?: string
          is_smokeable?: boolean
          name: string
          unit_type?: Database["public"]["Enums"]["product_unit"]
          updated_at?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          id?: string
          is_smokeable?: boolean
          name?: string
          unit_type?: Database["public"]["Enums"]["product_unit"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          buy_price: number
          category_id: string
          club_id: string
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          name: string
          notes: string | null
          sell_price: number
          stock: number
          strain: Database["public"]["Enums"]["strain_type"] | null
          updated_at: string
        }
        Insert: {
          buy_price?: number
          category_id: string
          club_id: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
          notes?: string | null
          sell_price?: number
          stock?: number
          strain?: Database["public"]["Enums"]["strain_type"] | null
          updated_at?: string
        }
        Update: {
          buy_price?: number
          category_id?: string
          club_id?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          notes?: string | null
          sell_price?: number
          stock?: number
          strain?: Database["public"]["Enums"]["strain_type"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          club_id: string
          created_at: string
          created_by: string | null
          delta: number
          id: string
          notes: string | null
          product_id: string
          reason: string
        }
        Insert: {
          club_id: string
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          notes?: string | null
          product_id: string
          reason?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          notes?: string | null
          product_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          club_id: string | null
          created_at: string
          id: string
          permissions: Database["public"]["Enums"]["app_permission"][]
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          id?: string
          permissions?: Database["public"]["Enums"]["app_permission"][]
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          club_id?: string | null
          created_at?: string
          id?: string
          permissions?: Database["public"]["Enums"]["app_permission"][]
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_order_with_items: {
        Args: { _items: Json; _member_id: string; _notes: string }
        Returns: string
      }
      current_club_id: { Args: never; Returns: string }
      current_open_cash_session: { Args: never; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      has_permission: {
        Args: {
          _perm: Database["public"]["Enums"]["app_permission"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      user_has_club_access: { Args: { _club_id: string }; Returns: boolean }
    }
    Enums: {
      app_permission:
        | "manage_members"
        | "manage_products"
        | "manage_collaborators"
        | "view_reports"
        | "use_cash"
      app_role: "admin" | "collaborator" | "super_admin"
      product_type: "per_gram" | "per_piece"
      product_unit: "gr" | "unit"
      strain_type: "indica" | "sativa" | "hibrida"
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
    Enums: {
      app_permission: [
        "manage_members",
        "manage_products",
        "manage_collaborators",
        "view_reports",
        "use_cash",
      ],
      app_role: ["admin", "collaborator", "super_admin"],
      product_type: ["per_gram", "per_piece"],
      product_unit: ["gr", "unit"],
      strain_type: ["indica", "sativa", "hibrida"],
    },
  },
} as const
