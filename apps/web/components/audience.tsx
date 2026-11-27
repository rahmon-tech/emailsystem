"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  Chip,
  DialogActions,
  DialogContent,
  Divider,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import {
  Add,
  ExpandMore,
  PeopleOutlined,
  SendOutlined,
  UploadFileOutlined,
} from "@mui/icons-material";
import { api } from "./api-client";
import {
  EmptyState,
  Failure,
  Loading,
  PageTitle,
  ResponsiveDialog,
} from "./shared";

type Contact = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  source: string;
  status: "ACTIVE" | "SUPPRESSED" | "ARCHIVED";
  suppressionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type ContactPage = {
  items: Contact[];
  nextCursor: string | null;
  summary: {
    activeContacts: number;
    savedLists: number;
    suppressions: number;
  };
};

type ListRow = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  _count: { memberships: number };
};

type Suppression = {
  id: string;
  email: string;
  reason: string;
  createdAt: string;
};

type ImportRow = {
  id: string;
  filename: string;
  stats: Record<string, number>;
  createdAt: string;
};

export function Audience() {
  const router = useRouter();
  const [tab, setTab] = useState(0);
  const [contacts, setContacts] = useState<ContactPage | null>(null);
  const [lists, setLists] = useState<ListRow[]>([]);
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [search, setSearch] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [suppressOpen, setSuppressOpen] = useState(false);
  const [contactForm, setContactForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    listId: "",
  });
  const [listForm, setListForm] = useState({ name: "", description: "" });
  const [suppressEmail, setSuppressEmail] = useState("");

  const refreshContacts = async (query = search) => {
    const suffix = query.trim()
      ? "?search=" + encodeURIComponent(query.trim())
      : "";
    setContacts(await api<ContactPage>("contacts" + suffix));
  };
  const refreshLists = async () =>
    setLists(await api<ListRow[]>("audience-lists"));
  const refreshSuppressions = async () =>
    setSuppressions(await api<Suppression[]>("suppressions"));

  const refresh = async () => {
    setError("");
    try {
      await Promise.all([
        refreshContacts(),
        refreshLists(),
        refreshSuppressions(),
      ]);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
    // Initial load only; search is submitted explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (key: string, operation: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy("");
    }
  };

  const importRecipients = async (file?: File) => {
    await run("import", async () => {
      if (file && file.size > 10_000_000)
        throw new Error("Choose a recipient file under 10 MB.");
      const body = new FormData();
      if (file) {
        body.set("file", file);
      } else {
        const addresses = paste
          .split(/[,;\n\r]+/)
          .map((value) => value.trim())
          .filter(Boolean);
        if (!addresses.length) throw new Error("Paste at least one email address.");
        body.set("paste", addresses.join("\n"));
      }
      await api<ImportRow>("imports", body);
      setPaste("");
      await Promise.all([refreshContacts(), refreshLists()]);
      setTab(1);
    });
  };

  const summary = contacts?.summary;

  return (
    <>
      <PageTitle
        title="Audience"
        description="Manage contacts and reusable lists. Campaigns always receive a safe snapshot of the selected list."
        action={
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => {
              setContactForm({
                email: "",
                firstName: "",
                lastName: "",
                listId: lists[0]?.id ?? "",
              });
              setContactOpen(true);
            }}
          >
            Add contact
          </Button>
        }
      />
      <Failure error={error} />

      {!contacts ? (
        error ? null : <Loading />
      ) : (
        <Stack spacing={2.5}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(3,minmax(0,1fr))",
              gap: 1.5,
            }}
          >
            {[
              ["Contacts", summary?.activeContacts ?? 0],
              ["Lists", summary?.savedLists ?? 0],
              ["Suppressed", summary?.suppressions ?? 0],
            ].map(([label, value]) => (
              <Card key={String(label)} sx={{ p: { xs: 1.5, sm: 2 } }}>
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Typography
                  sx={{
                    mt: 0.4,
                    fontSize: { xs: 23, sm: 28 },
                    fontWeight: 700,
                    letterSpacing: "-.03em",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {Number(value).toLocaleString()}
                </Typography>
              </Card>
            ))}
          </Box>

          <Card sx={{ overflow: "hidden" }}>
            <Tabs
              value={tab}
              onChange={(_, value) => setTab(value)}
              variant="fullWidth"
            >
              <Tab label="Contacts" />
              <Tab label="Lists" />
              <Tab label="Suppressed" />
            </Tabs>
            <Divider />

            {tab === 0 && (
              <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  sx={{ gap: 1, mb: 2 }}
                  component="form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run("search", () => refreshContacts(search));
                  }}
                >
                  <TextField
                    label="Search contacts"
                    placeholder="Email or name"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <Button
                    type="submit"
                    disabled={!!busy}
                    sx={{ flexShrink: 0 }}
                  >
                    Search
                  </Button>
                </Stack>

                {!contacts.items.length ? (
                  <EmptyState
                    icon={<PeopleOutlined />}
                    title={search ? "No matching contacts" : "No contacts yet"}
                    description={
                      search
                        ? "Try another email address or name."
                        : "Import a list or add a contact to start building your audience."
                    }
                    action={
                      !search ? (
                        <Button onClick={() => setTab(1)}>
                          Import recipients
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <Stack divider={<Divider flexItem />}>
                    {contacts.items.map((contact) => {
                      const name = [contact.firstName, contact.lastName]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <Stack
                          key={contact.id}
                          direction={{ xs: "column", sm: "row" }}
                          sx={{
                            py: 1.5,
                            gap: 1.5,
                            alignItems: { xs: "stretch", sm: "center" },
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
                                {name || contact.email}
                              </Typography>
                              <Chip
                                size="small"
                                label={
                                  contact.status === "SUPPRESSED"
                                    ? "Do not send"
                                    : "Active"
                                }
                                color={
                                  contact.status === "SUPPRESSED"
                                    ? "warning"
                                    : "default"
                                }
                              />
                            </Stack>
                            {name && (
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ overflowWrap: "anywhere" }}
                              >
                                {contact.email}
                              </Typography>
                            )}
                            {contact.suppressionReason && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {contact.suppressionReason}
                              </Typography>
                            )}
                          </Box>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                          >
                            {contact.source === "manual"
                              ? "Added manually"
                              : "Imported"}
                          </Typography>
                        </Stack>
                      );
                    })}
                    {contacts.nextCursor && (
                      <Button
                        sx={{ mt: 2, alignSelf: "flex-start" }}
                        disabled={!!busy}
                        onClick={() =>
                          void run("more", async () => {
                            const suffix =
                              (search.trim()
                                ? "?search=" +
                                  encodeURIComponent(search.trim()) +
                                  "&"
                                : "?") +
                              "cursor=" +
                              encodeURIComponent(contacts.nextCursor!);
                            const next = await api<ContactPage>(
                              "contacts" + suffix,
                            );
                            setContacts((current) =>
                              current
                                ? {
                                    ...next,
                                    items: [...current.items, ...next.items],
                                  }
                                : next,
                            );
                          })
                        }
                      >
                        Load more
                      </Button>
                    )}
                  </Stack>
                )}
              </Box>
            )}

            {tab === 1 && (
              <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  sx={{
                    gap: 1,
                    justifyContent: "space-between",
                    alignItems: { xs: "stretch", sm: "center" },
                    mb: 2,
                  }}
                >
                  <Box>
                    <Typography sx={{ fontWeight: 650 }}>
                      Reusable lists
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Edit the audience here. A campaign gets its own immutable
                      snapshot when you choose Use in campaign.
                    </Typography>
                  </Box>
                  <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
                    <Button
                      startIcon={<Add />}
                      onClick={() => {
                        setListForm({ name: "", description: "" });
                        setListOpen(true);
                      }}
                    >
                      New list
                    </Button>
                    <Button
                      component="label"
                      startIcon={<UploadFileOutlined />}
                      disabled={!!busy}
                    >
                      {busy === "import" ? "Importing…" : "Import file"}
                      <input
                        hidden
                        type="file"
                        accept=".csv,.txt,.xlsx"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void importRecipients(file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </Button>
                  </Stack>
                </Stack>

                <Accordion sx={{ mb: 2 }}>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography sx={{ fontSize: 14 }}>
                      Or paste email addresses
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <TextField
                      label="Email addresses"
                      placeholder="one@example.com"
                      multiline
                      minRows={4}
                      value={paste}
                      onChange={(event) => setPaste(event.target.value)}
                      helperText="One per line, or separate addresses with commas or semicolons."
                    />
                    <Button
                      sx={{ mt: 1 }}
                      disabled={!!busy || !paste.trim()}
                      onClick={() => void importRecipients()}
                    >
                      Import pasted addresses
                    </Button>
                  </AccordionDetails>
                </Accordion>

                {!lists.length ? (
                  <EmptyState
                    icon={<PeopleOutlined />}
                    title="No lists yet"
                    description="Import recipients or create an empty list and add contacts to it."
                  />
                ) : (
                  <Stack divider={<Divider flexItem />}>
                    {lists.map((list) => (
                      <Stack
                        key={list.id}
                        direction={{ xs: "column", md: "row" }}
                        sx={{
                          py: 1.6,
                          gap: 1.5,
                          alignItems: { xs: "stretch", md: "center" },
                        }}
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 650 }}>
                            {list.name}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {list._count.memberships.toLocaleString()} contact
                            {list._count.memberships === 1 ? "" : "s"}
                            {list.description ? " · " + list.description : ""}
                          </Typography>
                        </Box>
                        <Button
                          startIcon={<SendOutlined />}
                          disabled={
                            !!busy || list._count.memberships === 0
                          }
                          onClick={() =>
                            void run("snapshot:" + list.id, async () => {
                              const snapshot = await api<ImportRow>(
                                "audience-lists/" + list.id + "/snapshot",
                                {},
                              );
                              router.push(
                                "/blast?importId=" +
                                  encodeURIComponent(snapshot.id),
                              );
                            })
                          }
                        >
                          {busy === "snapshot:" + list.id
                            ? "Preparing…"
                            : "Use in campaign"}
                        </Button>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Box>
            )}

            {tab === 2 && (
              <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  sx={{
                    gap: 1,
                    justifyContent: "space-between",
                    alignItems: { xs: "stretch", sm: "center" },
                    mb: 2,
                  }}
                >
                  <Box>
                    <Typography sx={{ fontWeight: 650 }}>
                      Do-not-send addresses
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Hard bounces, complaints, unsubscribes and manual blocks
                      are excluded again at send time.
                    </Typography>
                  </Box>
                  <Button onClick={() => setSuppressOpen(true)}>
                    Suppress address
                  </Button>
                </Stack>
                {!suppressions.length ? (
                  <EmptyState
                    icon={<PeopleOutlined />}
                    title="No suppressed addresses"
                    description="Addresses that must not receive campaigns will appear here."
                  />
                ) : (
                  <Stack divider={<Divider flexItem />}>
                    {suppressions.map((row) => (
                      <Stack
                        key={row.id}
                        direction={{ xs: "column", sm: "row" }}
                        sx={{
                          py: 1.5,
                          gap: 1,
                          justifyContent: "space-between",
                        }}
                      >
                        <Typography sx={{ overflowWrap: "anywhere" }}>
                          {row.email}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {row.reason} ·{" "}
                          {new Date(row.createdAt).toLocaleDateString()}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Box>
            )}
          </Card>
        </Stack>
      )}

      <ResponsiveDialog
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        title="Add contact"
        width={500}
        busy={busy === "contact"}
      >
        <DialogContent>
          <Stack spacing={2}>
            <TextField
              label="Email address"
              type="email"
              required
              value={contactForm.email}
              onChange={(event) =>
                setContactForm((current) => ({
                  ...current,
                  email: event.target.value,
                }))
              }
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                label="First name"
                value={contactForm.firstName}
                onChange={(event) =>
                  setContactForm((current) => ({
                    ...current,
                    firstName: event.target.value,
                  }))
                }
              />
              <TextField
                label="Last name"
                value={contactForm.lastName}
                onChange={(event) =>
                  setContactForm((current) => ({
                    ...current,
                    lastName: event.target.value,
                  }))
                }
              />
            </Stack>
            <TextField
              select
              label="Add to list"
              value={contactForm.listId}
              onChange={(event) =>
                setContactForm((current) => ({
                  ...current,
                  listId: event.target.value,
                }))
              }
              helperText="Optional. Contacts can exist without being placed in a list."
            >
              <MenuItem value="">No list yet</MenuItem>
              {lists.map((list) => (
                <MenuItem key={list.id} value={list.id}>
                  {list.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setContactOpen(false)} disabled={!!busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!!busy || !contactForm.email.trim()}
            onClick={() =>
              void run("contact", async () => {
                await api("contacts", {
                  email: contactForm.email,
                  firstName: contactForm.firstName || undefined,
                  lastName: contactForm.lastName || undefined,
                  listId: contactForm.listId || undefined,
                });
                setContactOpen(false);
                await Promise.all([refreshContacts(), refreshLists()]);
              })
            }
          >
            Add contact
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={listOpen}
        onClose={() => setListOpen(false)}
        title="Create list"
        width={500}
        busy={busy === "list"}
      >
        <DialogContent>
          <Stack spacing={2}>
            <TextField
              label="List name"
              required
              value={listForm.name}
              onChange={(event) =>
                setListForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
            <TextField
              label="Description"
              multiline
              minRows={3}
              value={listForm.description}
              onChange={(event) =>
                setListForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setListOpen(false)} disabled={!!busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!!busy || !listForm.name.trim()}
            onClick={() =>
              void run("list", async () => {
                await api("audience-lists", listForm);
                setListOpen(false);
                await refreshLists();
                await refreshContacts();
              })
            }
          >
            Create list
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={suppressOpen}
        onClose={() => setSuppressOpen(false)}
        title="Suppress address"
        width={480}
        busy={busy === "suppress"}
      >
        <DialogContent>
          <Stack spacing={2}>
            <Alert severity="info">
              A manually suppressed address is excluded from current and future
              campaigns. This does not delete the contact.
            </Alert>
            <TextField
              label="Email address"
              type="email"
              value={suppressEmail}
              onChange={(event) => setSuppressEmail(event.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSuppressOpen(false)} disabled={!!busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!!busy || !suppressEmail.trim()}
            onClick={() =>
              void run("suppress", async () => {
                await api("suppressions", { email: suppressEmail });
                setSuppressEmail("");
                setSuppressOpen(false);
                await Promise.all([
                  refreshSuppressions(),
                  refreshContacts(),
                ]);
              })
            }
          >
            Suppress
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </>
  );
}
