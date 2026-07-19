// Mirrors backend/schema.py. Keep in sync manually — no codegen step in
// this build, so a field renamed on one side needs the same rename here.

export type IntakeSource = "voice_interview" | "document" | "manual_form";

export interface JobSpec {
  job_id: string;
  vertical: string;
  created_at: string;
  updated_at: string;
  fields: Record<string, unknown>;
  field_sources: Record<string, IntakeSource>;
  needs_review: string[];
  confirmed: boolean;
  confirmed_at: string | null;
}

export interface JobSpecFieldDef {
  type: "string" | "number" | "boolean" | "array";
  required?: boolean;
  asked_by_interview?: boolean;
  enum?: string[];
  example?: string[];
  description?: string;
}

export type JobSpecSchema = Record<string, JobSpecFieldDef>;

export type CallStatus = "queued" | "dialing" | "in_progress" | "completed" | "failed" | "no_answer";

export type CallOutcome =
  | "quote_given"
  | "callback_promised"
  | "declined"
  | "no_prices_over_phone"
  | "hang_up"
  | "unreachable";

export type NegotiationStyle = "tough_negotiator" | "stonewaller" | "hard_sell_upseller" | "straight_shooter";

export interface LineItem {
  label: string;
  amount: number;
  is_optional_or_conditional: boolean;
  notes?: string | null;
}

export interface Quote {
  quote_id: string;
  job_id: string;
  call_id: string;
  company_name: string;
  phone_number: string;
  base_price: number | null;
  line_items: LineItem[];
  total_price: number | null;
  currency: string;
  negotiation_style_label: NegotiationStyle | null;
  outcome: CallOutcome;
  callback_time: string | null;
  binding: boolean;
  is_red_flag: boolean;
  red_flag_reason: string | null;
  red_flag_pct_below_market: number | null;
  pre_negotiation_total: number | null;
  post_negotiation_total: number | null;
  negotiation_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptTurn {
  speaker: "agent" | "counterparty";
  text: string;
  timestamp_s: number;
}

export interface CallRecord {
  call_id: string;
  job_id: string;
  company_name: string;
  phone_number: string;
  negotiation_style_label: NegotiationStyle | null;
  status: CallStatus;
  elevenlabs_conversation_id: string | null;
  twilio_call_sid: string | null;
  transcript: TranscriptTurn[];
  recording_url: string | null;
  started_at: string | null;
  ended_at: string | null;
  quote_id: string | null;
  is_negotiation_callback: boolean;
  competing_quote_used_as_leverage: string | null;
  negotiating_quote_id: string | null;
  mode: "simulation" | "telephony";
  error: string | null;
}

export interface RankedQuote {
  rank: number;
  quote: Quote;
  call: CallRecord;
  score_notes: string;
}

export interface Report {
  job_id: string;
  generated_at: string;
  ranked_quotes: RankedQuote[];
  recommended_quote_id: string | null;
  plain_language_summary: string;
  market_spread: { min: number; max: number; median: number };
  red_flags: string[];
}

export interface ConfigCategory {
  required: boolean;
  missing: { name: string; description: string; needed_for?: string[] }[];
}

export type CallMode = "simulation" | "telephony";

export interface HealthStatus {
  call_mode: CallMode;
  ready_for_calls: boolean; // ready for the *active* call_mode
  simulation_ready: boolean;
  telephony_ready: boolean;
  voice_intake_available: boolean;
  interview_agent_id: string | null;
  call_list_source: "tavily" | "google_places" | "manual";
  categories: Record<string, ConfigCategory>;
  missing_required_count: number;
  jobs_in_memory: number;
}

export interface CallListResult {
  name: string;
  phone_number: string;
  address?: string;
  rating?: number | null;
  user_rating_count?: number | null;
  source?: string;
  source_url?: string | null;
}

export type Stage = "brief" | "calls" | "negotiate" | "report";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}
