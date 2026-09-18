# Contributing to EmailBlast

Thanks for taking an interest in EmailBlast.

The project favors small, reviewable changes that preserve delivery correctness, provider policy boundaries, and durable state semantics.

## Before opening a pull request

1. Search existing issues and pull requests.
2. Keep the change focused on one problem.
3. Do not include provider credentials, recipient data, production logs with personal data, database dumps, or private infrastructure details.
4. Add or update tests for behavior changes.
5. Run the relevant verification commands.

## Development setup

See the [README](README.md#quick-start) for the full local setup.

Core checks:

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm lint
pnpm secrets:scan
pnpm typecheck
pnpm test
```

For changes involving database, queues, providers, delivery state, or browser behavior, also run the relevant integration and E2E suites.

```sh
pnpm test:integration
pnpm build
pnpm test:e2e
```

## Engineering expectations

Changes should preserve these boundaries:

- PostgreSQL remains the durable source of truth.
- Redis/BullMQ coordinate asynchronous work and short-lived capacity.
- Provider-specific logic stays behind provider adapters/catalog metadata.
- Provider acceptance is not reported as confirmed mailbox delivery.
- Unknown outcomes are not blindly retried.
- Sender authorization, suppressions, safety limits, and provider enforcement cannot be bypassed by failover.
- Credentials must never be returned through normal browser/API responses.
- Production migrations must be explicit Prisma migrations; do not use `prisma db push` as a release mechanism.

## Pull requests

A useful pull request should explain:

- the problem;
- the intended behavior;
- the implementation boundary;
- tests added or updated;
- migration/environment impact;
- any operational or provider-specific implications.

Screenshots are useful for UI changes, but remove personal data and secrets first.

## Security issues

Do not disclose security vulnerabilities publicly before a fix is available.

Read [SECURITY.md](SECURITY.md) for reporting guidance.

## Responsible-use boundary

EmailBlast is designed for legitimate, permission-based email operations.

Changes whose purpose is to evade provider enforcement, suppressions, recipient-consent controls, abuse-prevention systems, or uncertain-delivery safeguards are outside the project scope.

## License

The repository currently has no open-source license. Public visibility alone does not grant reuse rights. Please review the repository license status before depending on or redistributing the project.
