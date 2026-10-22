# Security

Watching Everything is a single-user local administration service, not a public multi-tenant
search engine. The local edition opens without a login gate.

- Default HTTP port is bound to loopback. Keep that default for local use.
- Local business endpoints do not require a password; foreign Origin headers are rejected.
- Keep the service bound to loopback. Public deployment requires a separate access layer.
- Third-party configuration is encrypted on disk; the host administrator can still
  read the encryption key. Encryption is not protection against a compromised host.
- No built-in resource host, cloud relay, analytics endpoint or credential telemetry.
- Arbitrary source URLs are an administrator capability, including LAN addresses.
  Do not expose this interface to untrusted users; this is not an SSRF-isolated sandbox.
- Sources may contain untrusted resource names. The UI escapes text and uses a CSP.
- Credentials are removed from API connection responses, error details and normal logs.
- Docker runs as an unprivileged user, with no capabilities and a read-only root filesystem.

Back up the entire data directory securely. Do not share `admin.token`, `master.key`,
SQLite files, full connection configurations or logs containing your private titles.
Legacy `admin.token` files are retained for data compatibility but do not gate local access.

Report issues privately to the repository maintainer using GitHub private security
advisories when available. Do not paste live credentials into public issues.
