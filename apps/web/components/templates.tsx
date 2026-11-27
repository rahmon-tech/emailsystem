"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Button,
  Card,
  Chip,
  DialogActions,
  DialogContent,
  Divider,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  DeleteOutlined,
  MailOutlined,
  SendOutlined,
  VisibilityOutlined,
} from "@mui/icons-material";
import { api } from "./api-client";
import {
  EmptyState,
  Failure,
  Loading,
  PageTitle,
  ResponsiveDialog,
} from "./shared";

type TemplateSummary = {
  id: string;
  name: string;
  category: string;
  subject: string;
  preheader: string;
  editorMode: "rich" | "source";
  kind: "starter" | "custom";
  createdAt?: string;
  updatedAt?: string;
};

type TemplateList = {
  starters: TemplateSummary[];
  custom: TemplateSummary[];
};

type FullTemplate = TemplateSummary & {
  html: string;
  text: string;
  previewHtml: string;
};

export function Templates() {
  const router = useRouter();
  const [data, setData] = useState<TemplateList | null>(null);
  const [tab, setTab] = useState(0);
  const [preview, setPreview] = useState<FullTemplate | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => setData(await api<TemplateList>("templates"));

  useEffect(() => {
    let live = true;
    void api<TemplateList>("templates")
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

  const rows = data ? (tab === 0 ? data.starters : data.custom) : [];

  return (
    <>
      <PageTitle
        title="Templates"
        description="Start faster with a proven layout, or reuse messages you save from the campaign composer."
        action={
          <Button
            variant="contained"
            startIcon={<SendOutlined />}
            onClick={() => router.push("/blast")}
          >
            Create campaign
          </Button>
        }
      />
      <Failure error={error} />

      {!data ? (
        error ? null : <Loading />
      ) : (
        <Card sx={{ overflow: "hidden" }}>
          <Tabs
            value={tab}
            onChange={(_, value) => setTab(value)}
            variant="fullWidth"
          >
            <Tab label={"Starter templates (" + data.starters.length + ")"} />
            <Tab label={"My templates (" + data.custom.length + ")"} />
          </Tabs>
          <Divider />

          {!rows.length ? (
            <EmptyState
              icon={<MailOutlined />}
              title="No saved templates yet"
              description="Build a campaign, then choose Save as template to keep the message for later."
              action={
                <Button
                  variant="contained"
                  onClick={() => router.push("/blast")}
                >
                  Create campaign
                </Button>
              }
            />
          ) : (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  sm: "repeat(2,minmax(0,1fr))",
                  xl: "repeat(3,minmax(0,1fr))",
                },
                gap: 1.5,
                p: { xs: 2, sm: 2.5 },
              }}
            >
              {rows.map((template) => (
                <Card
                  key={template.id}
                  variant="outlined"
                  sx={{
                    p: 2,
                    border: 1,
                    borderColor: "divider",
                    boxShadow: "none",
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 210,
                  }}
                >
                  <Stack
                    direction="row"
                    sx={{
                      gap: 1,
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                    }}
                  >
                    <Chip size="small" label={template.category} />
                    {template.kind === "custom" && (
                      <Tooltip title="Delete template">
                        <IconButton
                          size="small"
                          aria-label={"Delete " + template.name}
                          disabled={!!busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                "Delete " + template.name + "?",
                              )
                            )
                              return;
                            setBusy(template.id);
                            setError("");
                            void api(
                              "templates/" +
                                encodeURIComponent(template.id),
                              undefined,
                              "DELETE",
                            )
                              .then(refresh)
                              .catch((reason) =>
                                setError((reason as Error).message),
                              )
                              .finally(() => setBusy(""));
                          }}
                        >
                          <DeleteOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                  <Typography variant="h6" sx={{ mt: 1.5 }}>
                    {template.name}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 0.75, flex: 1 }}
                  >
                    {template.subject || "No default subject"}
                  </Typography>
                  {template.editorMode === "source" && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 1 }}
                    >
                      Preserves source HTML
                    </Typography>
                  )}
                  <Stack
                    direction="row"
                    sx={{ gap: 1, mt: 2, flexWrap: "wrap" }}
                  >
                    <Button
                      size="small"
                      startIcon={<VisibilityOutlined />}
                      disabled={!!busy}
                      onClick={() => {
                        setBusy("preview:" + template.id);
                        setError("");
                        void api<FullTemplate>(
                          "templates/" + encodeURIComponent(template.id),
                        )
                          .then(setPreview)
                          .catch((reason) =>
                            setError((reason as Error).message),
                          )
                          .finally(() => setBusy(""));
                      }}
                    >
                      Preview
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<SendOutlined />}
                      onClick={() =>
                        router.push(
                          "/blast?templateId=" +
                            encodeURIComponent(template.id),
                        )
                      }
                    >
                      Use template
                    </Button>
                  </Stack>
                </Card>
              ))}
            </Box>
          )}
        </Card>
      )}

      <ResponsiveDialog
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.name ?? "Template preview"}
        width={760}
        mobileFullScreen
      >
        <DialogContent>
          {preview && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Subject
                </Typography>
                <Typography sx={{ fontWeight: 650 }}>
                  {preview.subject || "No default subject"}
                </Typography>
                {preview.preheader && (
                  <Typography variant="body2" color="text.secondary">
                    {preview.preheader}
                  </Typography>
                )}
              </Box>
              <Box
                component="iframe"
                title={preview.name + " preview"}
                sandbox=""
                srcDoc={preview.previewHtml}
                sx={{
                  width: "100%",
                  height: { xs: 420, sm: 520 },
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1.5,
                  bgcolor: "white",
                }}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(null)}>Close</Button>
          {preview && (
            <Button
              variant="contained"
              onClick={() =>
                router.push(
                  "/blast?templateId=" +
                    encodeURIComponent(preview.id),
                )
              }
            >
              Use template
            </Button>
          )}
        </DialogActions>
      </ResponsiveDialog>
    </>
  );
}
