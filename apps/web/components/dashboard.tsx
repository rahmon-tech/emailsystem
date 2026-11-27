"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import {
  ArrowForward,
  CheckCircleOutline,
  ErrorOutline,
  HubOutlined,
  MailOutline,
  RocketLaunchOutlined,
  ShieldOutlined,
} from "@mui/icons-material";
import { api } from "./api-client";
import { EmptyState, Failure, Loading, PageTitle, Status } from "./shared";

type DashboardData = {
  periodStart: string;
  metrics: {
    delivered: number;
    attempted: number;
    hardBounces: number;
    complaints: number;
    bounceRate: number;
    complaintRate: number;
    savedLists: number;
    suppressions: number;
  };
  readiness: {
    complete: boolean;
    completedSteps: number;
    totalSteps: number;
    steps: {
      key: string;
      title: string;
      description: string;
      complete: boolean;
      href: string;
      action: string;
    }[];
  };
  sending: {
    providers: number;
    healthyProviders: number;
    attentionProviders: number;
    verifiedDomains: number;
    usableSenders: number;
    accountPausedReason: string | null;
    domainPauses: {
      domain: string;
      pausedReason: string;
      pausedAt: string | null;
    }[];
  };
  recentCampaigns: {
    id: string;
    name: string;
    state: string;
    intendedRecipientCount: number;
    scheduledAt: string;
    createdAt: string;
    delivered: number;
    bounced: number;
    failed: number;
  }[];
};

const percent = (value: number) =>
  value
    ? new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(value)
    : "0%";

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void api<DashboardData>("dashboard")
      .then((value) => {
        if (live) setData(value);
      })
      .catch((reason) => {
        if (live) setError((reason as Error).message);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <PageTitle
        title="Dashboard"
        description="Your sending health, campaign results and next actions in one place."
        action={
          <Button
            component={Link}
            href="/blast"
            variant="contained"
            startIcon={<RocketLaunchOutlined />}
          >
            Create campaign
          </Button>
        }
      />
      <Failure error={error} />
      {!data ? (
        error ? null : <Loading />
      ) : (
        <Stack spacing={2.5}>
          {(data.sending.accountPausedReason ||
            data.sending.domainPauses.length > 0) && (
            <Alert
              severity="warning"
              icon={<ShieldOutlined />}
              action={
                <Button component={Link} href="/activity" color="inherit">
                  Review
                </Button>
              }
            >
              {data.sending.accountPausedReason
                ? data.sending.accountPausedReason
                : data.sending.domainPauses.length +
                  " sending domain" +
                  (data.sending.domainPauses.length === 1 ? "" : "s") +
                  " need" +
                  (data.sending.domainPauses.length === 1 ? "s" : "") +
                  " review."}
            </Alert>
          )}

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "repeat(2,minmax(0,1fr))",
                lg: "repeat(4,minmax(0,1fr))",
              },
              gap: 1.5,
            }}
          >
            {[
              ["Delivered", data.metrics.delivered.toLocaleString(), "This month"],
              [
                "Bounce rate",
                percent(data.metrics.bounceRate),
                data.metrics.hardBounces.toLocaleString() + " hard bounces",
              ],
              [
                "Complaint rate",
                percent(data.metrics.complaintRate),
                data.metrics.complaints.toLocaleString() + " complaints",
              ],
              [
                "Saved lists",
                data.metrics.savedLists.toLocaleString(),
                data.metrics.suppressions.toLocaleString() + " suppressed",
              ],
            ].map(([label, value, helper]) => (
              <Card key={label} sx={{ p: { xs: 1.75, sm: 2.25 } }}>
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Typography
                  sx={{
                    mt: 0.5,
                    fontSize: { xs: 24, sm: 30 },
                    lineHeight: 1.15,
                    fontWeight: 700,
                    letterSpacing: "-.035em",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {value}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {helper}
                </Typography>
              </Card>
            ))}
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                lg: "minmax(0,1.1fr) minmax(320px,.9fr)",
              },
              gap: 2.5,
              alignItems: "start",
            }}
          >
            <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
              <Stack
                direction="row"
                sx={{
                  justifyContent: "space-between",
                  gap: 2,
                  alignItems: "flex-start",
                }}
              >
                <Box>
                  <Typography variant="h6">Get ready to send</Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                  >
                    Complete the essentials once. EmailBlast keeps the technical
                    checks underneath.
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  color={data.readiness.complete ? "success" : "default"}
                  label={
                    data.readiness.completedSteps +
                    "/" +
                    data.readiness.totalSteps
                  }
                />
              </Stack>
              <LinearProgress
                variant="determinate"
                value={
                  (data.readiness.completedSteps /
                    data.readiness.totalSteps) *
                  100
                }
                sx={{ mt: 2, mb: 1 }}
              />
              <Stack divider={<Divider flexItem />}>
                {data.readiness.steps.map((step) => (
                  <Stack
                    key={step.key}
                    direction={{ xs: "column", sm: "row" }}
                    sx={{
                      py: 1.75,
                      gap: 1.5,
                      alignItems: { xs: "stretch", sm: "center" },
                    }}
                  >
                    <Stack
                      direction="row"
                      sx={{
                        gap: 1.25,
                        alignItems: "flex-start",
                        flex: 1,
                      }}
                    >
                      {step.complete ? (
                        <CheckCircleOutline
                          color="success"
                          sx={{ mt: 0.15 }}
                        />
                      ) : (
                        <ErrorOutline color="action" sx={{ mt: 0.15 }} />
                      )}
                      <Box>
                        <Typography sx={{ fontWeight: 650 }}>
                          {step.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {step.description}
                        </Typography>
                      </Box>
                    </Stack>
                    <Button
                      component={Link}
                      href={step.href}
                      size="small"
                      endIcon={<ArrowForward />}
                      sx={{
                        alignSelf: { xs: "flex-start", sm: "center" },
                      }}
                    >
                      {step.action}
                    </Button>
                  </Stack>
                ))}
              </Stack>
            </Card>

            <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
              <Stack
                direction="row"
                sx={{ gap: 1, alignItems: "center", mb: 2 }}
              >
                <HubOutlined fontSize="small" />
                <Box>
                  <Typography variant="h6">Sending health</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Only items that affect sending are shown here.
                  </Typography>
                </Box>
              </Stack>
              <Stack spacing={1.5}>
                {[
                  [
                    "Sending services",
                    data.sending.healthyProviders,
                    data.sending.providers,
                    "/providers",
                  ],
                  [
                    "Verified domains",
                    data.sending.verifiedDomains,
                    data.sending.verifiedDomains,
                    "/providers",
                  ],
                  [
                    "Usable From addresses",
                    data.sending.usableSenders,
                    data.sending.usableSenders,
                    "/providers",
                  ],
                ].map(([label, ready, total, href]) => (
                  <Stack
                    key={String(label)}
                    component={Link}
                    href={String(href)}
                    direction="row"
                    sx={{
                      textDecoration: "none",
                      color: "inherit",
                      gap: 1.5,
                      alignItems: "center",
                      justifyContent: "space-between",
                      py: 1,
                    }}
                  >
                    <Typography>{label}</Typography>
                    <Typography
                      sx={{
                        fontWeight: 700,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {Number(ready).toLocaleString()}
                      {label === "Sending services"
                        ? " / " + Number(total).toLocaleString()
                        : ""}
                    </Typography>
                  </Stack>
                ))}
                {data.sending.attentionProviders > 0 && (
                  <Alert severity="warning">
                    {data.sending.attentionProviders +
                      " sending service" +
                      (data.sending.attentionProviders === 1 ? "" : "s") +
                      " need attention."}
                  </Alert>
                )}
              </Stack>
            </Card>
          </Box>

          <Card sx={{ overflow: "hidden" }}>
            <Stack
              direction="row"
              sx={{
                p: { xs: 2, sm: 2.5 },
                alignItems: "center",
                justifyContent: "space-between",
                gap: 2,
              }}
            >
              <Box>
                <Typography variant="h6">Recent campaigns</Typography>
                <Typography variant="body2" color="text.secondary">
                  Latest campaign status and outcomes.
                </Typography>
              </Box>
              <Button component={Link} href="/activity">
                View activity
              </Button>
            </Stack>
            <Divider />
            {!data.recentCampaigns.length ? (
              <EmptyState
                icon={<MailOutline />}
                title="No campaigns yet"
                description="Create your first campaign when your sending service and recipients are ready."
                action={
                  <Button component={Link} href="/blast" variant="contained">
                    Create campaign
                  </Button>
                }
              />
            ) : (
              <Stack divider={<Divider flexItem />}>
                {data.recentCampaigns.map((campaign) => (
                  <Stack
                    key={campaign.id}
                    direction={{ xs: "column", md: "row" }}
                    sx={{
                      px: { xs: 2, sm: 2.5 },
                      py: 1.75,
                      gap: { xs: 1, md: 2 },
                      alignItems: { xs: "stretch", md: "center" },
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack
                        direction="row"
                        sx={{
                          gap: 1,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <Typography
                          sx={{
                            fontWeight: 650,
                            overflowWrap: "anywhere",
                          }}
                        >
                          {campaign.name}
                        </Typography>
                        <Status value={campaign.state} />
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {campaign.intendedRecipientCount.toLocaleString()}{" "}
                        recipients
                      </Typography>
                    </Box>
                    <Stack
                      direction="row"
                      sx={{
                        gap: { xs: 2, sm: 3 },
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      {[
                        ["Delivered", campaign.delivered],
                        ["Bounced", campaign.bounced],
                        ["Failed", campaign.failed],
                      ].map(([label, value]) => (
                        <Box key={String(label)} sx={{ minWidth: 64 }}>
                          <Typography
                            sx={{
                              fontWeight: 700,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {Number(value).toLocaleString()}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                          >
                            {label}
                          </Typography>
                        </Box>
                      ))}
                      <Button
                        component={Link}
                        href={
                          "/activity?campaignId=" +
                          encodeURIComponent(campaign.id)
                        }
                        size="small"
                      >
                        Open
                      </Button>
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            )}
          </Card>
        </Stack>
      )}
    </>
  );
}
