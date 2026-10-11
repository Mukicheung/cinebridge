# Security

CineBridge is a single-user local administration service, not a public multi-tenant
search engine. Treat its access token as full control of its configured services.

- Default HTTP port is bound to loopback. Keep that default for local use.
- Browser writes require the bearer token and reject foreign Origin headers.
- All business endpoints require authentication. Only static UI and `/healthz` are public.
- Third-party configuration is encrypted on disk; the host administrator can still
  read the encryption key. Encryption is not protection against a compromised host.
- No built-in resource host, cloud relay, analytics endpoint or credential telemetry.
- Arbitrary source URLs are an administrator capability, including LAN addresses.
  Do not expose this interface to untrusted users; this is not an SSRF-isolated sandbox.
- Sources may contain untrusted resource names. The UI escapes text and uses a CSP.
- Credentials are removed from API connection responses, error details and normal logs.
- The browser token is retained only in sessionStorage for that tab session.
- Docker runs as an unprivileged user, with no capabilities and a read-only root filesystem.

Back up the entire data directory securely. Do not share `admin.token`, `master.key`,
SQLite files, full connection configurations or logs containing your private titles.
To rotate the local access key, stop the application, replace `admin.token` with a
new strong random value (file mode 0600), and restart. This invalidates old sessions.

Report issues privately to the repository maintainer using GitHub private security
advisories when available. Do not paste live credentials into public issues.
