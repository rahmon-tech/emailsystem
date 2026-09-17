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
    return { label: "Purged by retention", color: "warning" as const };
  if (!evidence.integrity.available)
    return { label: "Integrity unavailable", color: "default" as const };
  if (verification && !verification.valid)
    return { label: "Integrity check failed", color: "error" as const };
  if (evidence.integrity.count === 0)
    return { label: "No evidence yet", color: "default" as const };
  if (!verification)
    return { label: "Not yet verified", color: "default" as const };
  if (
    verification.count !== evidence.integrity.count ||
    verification.headHash !== evidence.integrity.headHash
  )
    return { label: "Verification outdated", color: "warning" as const };
  return { label: "Chain verified", color: "success" as const };
}

const eventLabel = (kind: string) => kind.replaceAll(".", " ").replaceAll("-", " ");

export function ActivityExperimentEvidence() {
  const params = useSearchParams();
  const campaignId = params.get("campaignId") ?? "";
  const [result, setResult] = useState<Result | null>(null);
  const [verification, setVerification] = useState<VerificationSnapshot | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let live = true;
    setResult(null);
    setVerification(null);
    setVerifying(false);
    if (!campaignId) return;

    const refresh = (verify = false) => {
      if (verify) setVerifying(true);
      const suffix = verify ? "?verify=1" : "";
      void api<{ runId: string | null; evidence: EvidenceReview | null }>(
        `campaigns/${campaignId}/experiment/evidence${suffix}`,
      )
        .then(({ runId, evidence }) => {
          if (!live) return;
          setResult({ campaignId, runId, evidence });
          if (evidence) {
            const snapshot = verificationSnapshot(evidence);
            if (snapshot) setVerification(snapshot);
          }
        })
        .catch(() => {
          if (!live) return;
          setResult((current) =>
            current?.campaignId === campaignId
              ? current
              : { campaignId, runId: null, evidence: null },
          );
        })
        .finally(() => {
          if (live && verify) setVerifying(false);
        });
    };

    refresh(true);
    const timer = setInterval(() => refresh(false), 10_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [campaignId]);

  const verifyChain = () => {
    if (!campaignId || verifying) return;
    setVerifying(true);
    void api<{ runId: string | null; evidence: EvidenceReview | null }>(
      `campaigns/${campaignId}/experiment/evidence?verify=1`,
    )
      .then(({ runId, evidence }) => {
        setResult({ campaignId, runId, evidence });
        if (evidence) {
          const snapshot = verificationSnapshot(evidence);
          if (snapshot) setVerification(snapshot);
        }
      })
      .catch(() => {
        /* Keep the last known evidence summary and verification result. */
      })
      .finally(() => setVerifying(false));
  };

  if (!campaignId || result?.campaignId !== campaignId || !result.evidence)
    return null;

  const evidence = result.evidence;
  const status = evidenceStatus(evidence, verification);
  const verificationCurrent =
    verification?.valid === true &&
    verification.count === evidence.integrity.count &&
    verification.headHash === evidence.integrity.headHash;
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
                  {verifying ? "Verifying…" : "Verify chain"}
                </Button>
              )}
          </Stack>
        </Stack>

        {evidence.retention.status === "purged" ? (
          <Alert severity="warning">
            Experiment evidence was purged by the configured retention policy
            {evidence.retention.purgedAt
              ? ` on ${new Date(evidence.retention.purgedAt).toLocaleString()}`
              : ""}
            .
          </Alert>
        ) : verificationCurrent && verification ? (
          <Typography variant="body2" color="text.secondary">
            {evidence.integrity.count.toLocaleString()} chained entries · verified through #{verification.verifiedThrough.toLocaleString()}
            {head ? ` · head ${head}` : ""} · verified {new Date(verification.verifiedAt).toLocaleString()}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {evidence.integrity.count.toLocaleString()} retained entries · full-chain verification required
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
