# Controlled experiments

EmailBlast includes a bounded controlled-experiment subsystem for explicitly authorized testing.

It is an advanced operator/API capability and is intentionally separate from ordinary campaign sending. Experiment controls add constraints; they do not weaken normal provider, account, domain, campaign, suppression, or policy enforcement.

## Purpose

The experiment subsystem exists to run repeatable transport/content tests with a recorded authorization reference and explicit scope.

An experiment profile can constrain:

- provider connections;
- sender identities;
- recipient allowlist;
- maximum unique recipients;
- maximum transport attempts;
- maximum duration;
- optional approved start/end window;
- pacing behavior;
- concurrency;
- transfer encoding;
- content/message mode.

## Supported variables

### Pacing

Experiments support:

- **steady/smooth** pacing with a minimum interval between transport starts;
- **bounded burst** pacing with a maximum group size inside a configured window.

Normal EmailBlast pacing and safety limits continue to apply.

### Transfer encoding

Where the selected transport supports it, an experiment may request:

- provider default;
- quoted-printable;
- base64.

Explicit transfer encoding is capability-checked and is limited to transports that can actually honor it.

### Content mode

Experiment profiles can identify message modes such as:

- HTML;
- plain text;
- CID-inline image;
- hosted image;
- attachment-only;
- Image-first.

Provider capability checks reject unsupported combinations. For example, CID-inline content requires an eligible transport that supports inline attachments.

## Scope and ceilings

Creating an experiment profile requires an authorization reference and explicit scope.

The system validates that scoped providers and sender identities belong to the current account.

Recipient addresses are deduplicated and restricted by the controlled allowlist.

The configured attempt ceiling must remain bounded relative to the recipient ceiling.

An experiment run cannot start outside its approved window, after expiry, while the account experiment kill switch is active, or when its scoped provider/sender requirements cannot be met.

## Runtime behavior

Experiment-bound campaign delivery still runs through the normal delivery engine.

Before transport, the runtime checks:

- experiment state;
- approved time window;
- provider scope;
- sender scope;
- recipient scope;
- attempt/recipient ceilings;
- experiment pacing permit;
- ordinary EmailBlast safety and provider capacity.

If an experiment-specific boundary is unavailable, the system waits or stops according to the experiment state rather than silently escaping to an unapproved provider/sender.

Normal provider policy blocks still pause the affected work.

## Kill switch and stop control

An account-level experiment kill switch can prevent experiment transport.

Individual runs can also be stopped explicitly. The stop reason is persisted with the run.

Cancelling a campaign bound to an active run also stops the run.

## Evidence ledger

Experiment runs can write a tamper-evident evidence chain.

Recorded evidence can include:

- run start;
- transport start;
- transport outcome;
- authorization reference;
- profile version;
- configured ceilings/window;
- scoped provider IDs;
- scoped sender IDs;
- controlled recipient hashes;
- effective experiment pacing;
- requested/effective transfer encoding;
- requested/effective content mode.

Controlled recipient addresses are represented using run-scoped hashes in evidence records rather than being exposed directly in the ledger.

Each evidence entry participates in a hash chain so later review can detect modification or missing links.

## Evidence verification and export

Activity can:

- show recent experiment records;
- verify the current evidence chain;
- report whether the verification is current;
- export the experiment evidence.

Verification is explicit; a previous successful check is marked stale if the evidence head/count changes afterward.

## Retention

Experiment evidence and message snapshots have independent configurable retention periods.

After the message-retention window, sensitive campaign message content/attachments can be scrubbed while the experiment/run audit context remains.

When evidence is purged according to retention policy, an audit event records the purge so the UI can distinguish "no records" from "older records removed."

## Safety boundary

Experiments cannot be used to bypass:

- suppression state;
- provider policy blocks;
- sender/domain authorization;
- account/domain/provider/campaign budgets;
- ordinary rate/concurrency limits;
- unknown-delivery duplicate-prevention rules.

The subsystem is designed to make approved tests narrower and more observable than ordinary sending, not less constrained.

See [Architecture](ARCHITECTURE.md) for the shared delivery-state model and [Features](FEATURES.md) for normal campaign behavior.
