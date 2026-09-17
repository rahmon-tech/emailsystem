"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Alert,
  Box,
  Card,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { FactCheckOutlined } from "@mui/icons-material";
import { api } from "./api-client";

type EvidenceReview = {
  retention: { status: "retained" | "purged"; purgedAt: string | null };
  integrity: {
    available: boolean;
    valid: boolean;
    count: number;
    verifiedThrough: number;
    headHash: string | null;
  };
  recent: Array<{ sequence: number; kind: string; createdAt: string }>;
};

type Result = {
  campaignId: string;
  runId: string | null;
  evidence: EvidenceReview | null;
};

function evidenceStatus(evidence: EvidenceReview) {
  if (evidence.retention.status === "purged")
    return { label: "Purged by retention", color: "warning" as const };
  if (!evidence.integrity.available)
    return { label: "Integrity unavailable", color: "default" as const };
  if (!evidence.integrity.valid)
    return { label: "Integrity check failed", color: "error" as const };
  if (evidence.integrity.count === 0)
    return { label: "No evidence yet", color: "default" as const };
  return { label: "Chain verified", color: "success" as const };
}

const eventLabel = (kind: string) => kind.replaceAll(".", " ").replaceAll("-", " ");

export function ActivityExperimentEvidence() {
  const params = useSearchParams();
  const campaignId = params.get("campaignId") ?? "";
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    let live = true;
    if (!campaignId) return;
    const refresh = () =>
      void api<{ runId: string | null; evidence: EvidenceReview | null }>(
        `campaigns/${campaignId}/experiment/evidence`,
      )
        .then(({ runId, evidence }) => {
          if (live) setResult({ campaignId, runId, evidence });
        })
        .catch(() => {
          if (!live) return;
          setResult((current) =>
            current?.campaignId === campaignId
              ? current
              : { campaignId, runId: null, evidence: null },
          );
        });

    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [campaignId]);

  if (!campaignId || result?.campaignId !== campaignId || !result.evidence)
    return null;

  const evidence = result.evidence;
  const status = evidenceStatus(evidence);
  const head = evidence.integrity.headHash
    ? `${evidence.integrity.headHash.slice(0, 12)}…`
    : null;

  return (
    <Card
      component="section"
      aria-label="Experiment evidence review"
      sx={{ mb: 2, p: { xs: 1.75, sm: 2 } }}
    >
      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{ gap: 1, alignItems: { xs: "flex-start", sm: "center" } }}
        >
          <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
            <FactCheckOutlined fontSize="small" />
            <Box>
              <Typography sx={{ fontWeight: 700 }}>Evidence review</Typography>
              <Typography variant="caption" color="text.secondary">
                Tamper-evident experiment ledger
              </Typography>
            </Box>
          </Stack>
          <Chip
            size="small"
            label={status.label}
            color={status.color}
            sx={{ ml: { sm: "auto" } }}
          />
        </Stack>

        {evidence.retention.status === "purged" ? (
          <Alert severity="warning">
            Experiment evidence was purged by the configured retention policy
            {evidence.retention.purgedAt
              ? ` on ${new Date(evidence.retention.purgedAt).toLocaleString()}`
              : ""}
            .
          </Alert>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {evidence.integrity.count.toLocaleString()} chained entries · verified through #{evidence.integrity.verifiedThrough.toLocaleString()}
            {head ? ` · head ${head}` : ""}
          </Typography>
        )}

        <Box>
          <Typography variant="caption" color="text.secondary">
            Recent evidence
          </Typography>
          {evidence.recent.length ? (
            <Stack spacing={0.75} sx={{ mt: 0.75 }}>
              {evidence.recent.map((entry) => (
                <Stack
                  key={entry.sequence}
                  direction={{ xs: "column", sm: "row" }}
                  sx={{ gap: { xs: 0.25, sm: 1 }, justifyContent: "space-between" }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    #{entry.sequence} · {eventLabel(entry.kind)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(entry.createdAt).toLocaleString()}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              No retained evidence entries yet.
            </Typography>
          )}
        </Box>
      </Stack>
    </Card>
  );
}
