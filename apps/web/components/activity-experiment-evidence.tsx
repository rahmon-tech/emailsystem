"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Alert,
  Box,
  Button,
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
    verified: boolean;
    valid: boolean | null;
    count: number;
    verifiedThrough: number | null;
    headHash: string | null;
    verifiedAt: string | null;
  };
  recent: Array<{ sequence: number; kind: string; createdAt: string }>;
};

type Result = {
  campaignId: string;
  runId: string | null;
  evidence: EvidenceReview | null;
};

type VerificationSnapshot = {
  valid: boolean;
  count: number;
  verifiedThrough: number;
  headHash: string | null;
  verifiedAt: string;
};

function verificationSnapshot(evidence: EvidenceReview): VerificationSnapshot | null {
  if (
    !evidence.integrity.verified ||
    evidence.integrity.valid === null ||
    evidence.integrity.verifiedThrough === null ||
    !evidence.integrity.verifiedAt
  )
    return null;
  return {
    valid: evidence.integrity.valid,
    count: evidence.integrity.count,
    verifiedThrough: evidence.integrity.verifiedThrough,
    headHash: evidence.integrity.headHash,
    verifiedAt: evidence.integrity.verifiedAt,
  };
}

function evidenceStatus(
  evidence: EvidenceReview,
  verification: VerificationSnapshot | null,
) {
  if (evidence.retention.status === "purged")
    return { label: "Older records removed", color: "warning" as const };
  if (!evidence.integrity.available)
    return { label: "Record check unavailable", color: "default" as const };
  if (verification && !verification.valid)
    return { label: "Record check failed", color: "error" as const };
  if (evidence.integrity.count === 0)
    return { label: "No records yet", color: "default" as const };
  if (!verification)
    return { label: "Not checked yet", color: "default" as const };
  if (
    verification.count !== evidence.integrity.count ||
    verification.headHash !== evidence.integrity.headHash
  )
    return { label: "Check is out of date", color: "warning" as const };
  return { label: "Records verified", color: "success" as const };
}

const eventLabel = (kind: string) =>
  ({
    "run.started": "Experiment started",
    "transport.started": "Send started",
    "transport.outcome": "Send result",
  })[kind] ?? kind.replaceAll(".", " ").replaceAll("-", " ");
const entryWord = (count: number) => (count === 1 ? "entry" : "entries");

export function ActivityExperimentEvidence() {
  const params = useSearchParams();
  const campaignId = params.get("campaignId") ?? "";
  const [result, setResult] = useState<Result | null>(null);
  const [verificationByCampaign, setVerificationByCampaign] = useState<
    Record<string, VerificationSnapshot>
  >({});
  const [verifyingCampaignId, setVerifyingCampaignId] = useState<string | null>(null);

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

  const verifying = verifyingCampaignId === campaignId;
  const activeVerification = verificationByCampaign[campaignId] ?? null;

  const verifyChain = () => {
    if (!campaignId || verifying) return;
    const requestedCampaignId = campaignId;
    setVerifyingCampaignId(requestedCampaignId);
    void api<{ runId: string | null; evidence: EvidenceReview | null }>(
      `campaigns/${requestedCampaignId}/experiment/evidence?verify=1`,
    )
      .then(({ runId, evidence }) => {
        setResult((current) =>
          current && current.campaignId !== requestedCampaignId
            ? current
            : { campaignId: requestedCampaignId, runId, evidence },
        );
        if (evidence) {
          const snapshot = verificationSnapshot(evidence);
          if (snapshot)
            setVerificationByCampaign((current) => ({
              ...current,
              [requestedCampaignId]: snapshot,
            }));
        }
      })
      .catch(() => {
        /* Keep the last known evidence summary and verification result. */
      })
      .finally(() => {
        setVerifyingCampaignId((current) =>
          current === requestedCampaignId ? null : current,
        );
      });
  };

  if (!campaignId || result?.campaignId !== campaignId || !result.evidence)
    return null;

  const evidence = result.evidence;
  const status = evidenceStatus(evidence, activeVerification);
  const verificationCurrent =
    activeVerification?.valid === true &&
    activeVerification.count === evidence.integrity.count &&
    activeVerification.headHash === evidence.integrity.headHash;

  return (
    <Card
      component="section"
      aria-label="Experiment records"
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
              <Typography sx={{ fontWeight: 700 }}>Experiment records</Typography>
              <Typography variant="caption" color="text.secondary">
                Protected history of this controlled experiment
              </Typography>
            </Box>
          </Stack>
          <Stack
            direction="row"
            sx={{ ml: { sm: "auto" }, gap: 0.75, alignItems: "center" }}
          >
            <Chip size="small" label={status.label} color={status.color} />
            {evidence.retention.status === "retained" &&
              evidence.integrity.count > 0 && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={verifyChain}
                  disabled={verifying}
                >
                  {verifying ? "Checking…" : "Check records"}
                </Button>
              )}
          </Stack>
        </Stack>

        {evidence.retention.status === "purged" ? (
          <Alert severity="warning">
            Older experiment records were removed according to your record-keeping settings
            {evidence.retention.purgedAt
              ? ` on ${new Date(evidence.retention.purgedAt).toLocaleString()}`
              : ""}
            .
          </Alert>
        ) : verificationCurrent && activeVerification ? (
          <Typography variant="body2" color="text.secondary">
            {evidence.integrity.count.toLocaleString()} protected {entryWord(evidence.integrity.count)} · checked through record #{activeVerification.verifiedThrough.toLocaleString()} · checked {new Date(activeVerification.verifiedAt).toLocaleString()}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {evidence.integrity.count.toLocaleString()} protected {entryWord(evidence.integrity.count)} · run a record check to confirm they have not changed
          </Typography>
        )}

        <Box>
          <Typography variant="caption" color="text.secondary">
            Recent records
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
              No experiment records yet.
            </Typography>
          )}
        </Box>
      </Stack>
    </Card>
  );
}
