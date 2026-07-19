"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { BriefStage, BriefStageSkeleton } from "@/components/brief-stage";
import { CallsStage } from "@/components/calls-stage";
import { NegotiateStage } from "@/components/negotiate-stage";
import { ReportStage } from "@/components/report-stage";
import { LoginScreen } from "@/components/login-screen";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { api, ApiError } from "@/lib/api-client";
import { session } from "@/lib/session";
import type { HealthStatus, JobSpec, Stage } from "@/lib/types";

const STAGE_ORDER: Stage[] = ["brief", "calls", "negotiate", "report"];

function furthest(a: Stage, b: Stage): Stage {
  return STAGE_ORDER.indexOf(a) >= STAGE_ORDER.indexOf(b) ? a : b;
}

export default function Page() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [job, setJob] = useState<JobSpec | null>(null);
  const [stage, setStage] = useState<Stage>("brief");
  const [furthestReached, setFurthestReached] = useState<Stage>("brief");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [initializing, setInitializing] = useState(true);
  // Cinematic entry gate (not auth) — shown once per session before the app.
  const [entered, setEntered] = useState(false);

  const loadHealth = useCallback(() => {
    api.health().then(setHealth).catch(() => {});
  }, []);

  useEffect(() => {
    loadHealth();
    const id = setInterval(loadHealth, 30000);
    return () => clearInterval(id);
  }, [loadHealth]);

  const startFresh = useCallback(async () => {
    session.clear();
    setSessionExpired(false);
    setInitializing(true);
    try {
      const newJob = await api.createIntake("moving");
      session.setJobId(newJob.job_id);
      session.setStage("brief");
      setJob(newJob);
      setStage("brief");
      setFurthestReached("brief");
    } catch {
      // health panel will show the connectivity problem
    } finally {
      setInitializing(false);
    }
  }, []);

  useEffect(() => {
    const existingJobId = session.getJobId();
    if (!existingJobId) {
      void Promise.resolve().then(startFresh);
      return;
    }
    api
      .getIntake(existingJobId)
      .then((existingJob) => {
        setJob(existingJob);
        const savedStage = session.getStage() ?? "brief";
        const resolvedStage = existingJob.confirmed ? savedStage : "brief";
        setStage(resolvedStage);
        setFurthestReached(resolvedStage);
        setInitializing(false);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setSessionExpired(true);
          setInitializing(false);
        } else {
          setInitializing(false);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goToStage(next: Stage) {
    setStage(next);
    session.setStage(next);
    setFurthestReached((prev) => furthest(prev, next));
  }

  function handleJobUpdated(updated: JobSpec) {
    setJob(updated);
  }

  function handleConfirmed(confirmed: JobSpec) {
    setJob(confirmed);
    goToStage("calls");
  }

  if (!entered) {
    return <LoginScreen onEnter={() => setEntered(true)} />;
  }

  if (sessionExpired) {
    return (
      <AppShell stage="brief" furthestReached="brief" onNavigate={() => {}} health={health}>
        <Alert variant="warning">
          <AlertTitle>Your session expired</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              CallPilot keeps job state in memory on the backend — a server restart or redeploy clears it. Start a
              new job to continue; nothing about your previous move details was saved.
            </p>
            <Button size="sm" onClick={startFresh}>
              <RotateCcw className="size-3.5" /> Start a new job
            </Button>
          </AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  if (initializing || !job) {
    return (
      <AppShell stage="brief" furthestReached="brief" onNavigate={() => {}} health={health}>
        <BriefStageSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell stage={stage} furthestReached={furthestReached} onNavigate={goToStage} health={health}>
      {stage === "brief" && (
        <BriefStage job={job} health={health} onJobUpdated={handleJobUpdated} onConfirmed={handleConfirmed} />
      )}
      {stage === "calls" && (
        <CallsStage job={job} health={health} onCallsStarted={() => {}} onAdvance={() => goToStage("negotiate")} />
      )}
      {stage === "negotiate" && <NegotiateStage job={job} health={health} onAdvance={() => goToStage("report")} />}
      {stage === "report" && <ReportStage job={job} />}
    </AppShell>
  );
}
