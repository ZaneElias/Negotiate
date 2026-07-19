import {
  ApiError,
  type CallListResult,
  type CallRecord,
  type HealthStatus,
  type IntakeSource,
  type JobSpec,
  type JobSpecSchema,
  type NegotiationStyle,
  type Quote,
  type Report,
} from "@/lib/types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "Could not reach the CallPilot backend. Check your connection and try again.", null);
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body */
    }
    const message =
      (body as { detail?: { message?: string } | string })?.detail &&
      typeof (body as { detail: { message?: string } | string }).detail === "object"
        ? ((body as { detail: { message?: string } }).detail.message ?? res.statusText)
        : typeof (body as { detail?: string })?.detail === "string"
          ? (body as { detail: string }).detail
          : res.statusText;
    throw new ApiError(res.status, message || `Request failed (${res.status})`, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<HealthStatus>("/health"),

  createIntake: (vertical = "moving") =>
    request<JobSpec>("/intake", { method: "POST", body: JSON.stringify({ vertical }) }),

  getIntake: (jobId: string) => request<JobSpec>(`/intake/${jobId}`),

  getIntakeSchema: (jobId: string) => request<JobSpecSchema>(`/intake/${jobId}/schema`),

  updateIntake: (jobId: string, fields: Record<string, unknown>, source: IntakeSource = "manual_form") =>
    request<JobSpec>(`/intake/${jobId}/update`, {
      method: "POST",
      body: JSON.stringify({ fields, source }),
    }),

  uploadDocument: (jobId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<JobSpec>(`/intake/${jobId}/document`, { method: "POST", body: form });
  },

  confirmIntake: (jobId: string) => request<JobSpec>(`/intake/${jobId}/confirm`, { method: "POST" }),

  searchCallList: (category: string, location: string, maxResults = 8) =>
    request<CallListResult[]>(
      `/call-list/search?category=${encodeURIComponent(category)}&location=${encodeURIComponent(location)}&max_results=${maxResults}`
    ),

  counterpartyRoster: () =>
    request<{ style: string; description: string; configured: boolean }[]>("/calls/counterparty-roster"),

  startCalls: (
    jobId: string,
    targets: { company_name: string; phone_number?: string; negotiation_style_label?: NegotiationStyle }[]
  ) => request<CallRecord[]>(`/calls/${jobId}/start`, { method: "POST", body: JSON.stringify({ targets }) }),

  // Simulation mode: agent-to-agent, no telephony. Runs the Caller against each
  // counterparty persona and captures the quote from the transcript.
  simulateCalls: (jobId: string, styles: NegotiationStyle[]) =>
    request<CallRecord[]>(`/calls/${jobId}/simulate`, { method: "POST", body: JSON.stringify({ styles }) }),

  simulateNegotiation: (jobId: string, callbackCallIds: string[] = []) =>
    request<CallRecord[]>(`/negotiate/${jobId}/simulate`, {
      method: "POST",
      body: JSON.stringify({ callback_call_ids: callbackCallIds }),
    }),

  listCalls: (jobId: string, refresh = true) =>
    request<CallRecord[]>(`/calls/${jobId}?refresh=${refresh}`),

  listQuotes: (jobId: string) => request<Quote[]>(`/quotes/${jobId}`),

  startNegotiation: (jobId: string, callbackCallIds: string[] = []) =>
    request<CallRecord[]>(`/negotiate/${jobId}/start`, {
      method: "POST",
      body: JSON.stringify({ callback_call_ids: callbackCallIds }),
    }),

  getReport: (jobId: string) => request<Report>(`/report/${jobId}`),
};

export { ApiError };
