# Security Policy

Security documentation for EmailBlast is maintained in [docs/SECURITY.md](docs/SECURITY.md).

## Reporting a vulnerability

Please do **not** publish credentials, exploit details, recipient data, production configuration, or other sensitive information in a public issue.

Use GitHub's private security-reporting feature when it is available for this repository. If private reporting is unavailable, open a minimal public issue asking for a private contact method without including vulnerability details.

A useful report includes:

- affected commit/version;
- affected component;
- impact;
- reproduction conditions;
- whether authentication is required;
- relevant logs with secrets and personal data removed;
- suggested mitigation, if known.

## Scope priorities

Reports involving the following are especially important:

- authentication/session bypass;
- cross-account/tenant data access;
- provider credential exposure;
- encryption/decryption flaws;
- webhook signature/authentication bypass;
- unsafe HTML/content handling;
- SSRF or unsafe Custom SMTP resolution;
- duplicate-send conditions caused by delivery-state handling;
- suppression/unsubscribe bypass;
- production secret leakage;
- unauthorized mutation of campaign/provider state.

Please avoid testing against real recipients or third-party provider accounts without authorization.
