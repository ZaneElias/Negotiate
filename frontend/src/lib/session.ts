import type { Stage } from "@/lib/types";

const JOB_KEY = "callpilot:job_id";
const STAGE_KEY = "callpilot:stage";

export const session = {
  getJobId(): string | null {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(JOB_KEY);
  },
  setJobId(jobId: string) {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(JOB_KEY, jobId);
  },
  getStage(): Stage | null {
    if (typeof window === "undefined") return null;
    return (sessionStorage.getItem(STAGE_KEY) as Stage) || null;
  },
  setStage(stage: Stage) {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(STAGE_KEY, stage);
  },
  clear() {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(JOB_KEY);
    sessionStorage.removeItem(STAGE_KEY);
  },
};
