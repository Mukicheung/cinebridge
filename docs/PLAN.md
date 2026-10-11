# CineBridge 0.1 delivery plan

Build independently from public protocols. Do not copy any existing personal scripts,
private endpoints, credentials, database snapshots or deployment history.

## Acceptance
- Web and CLI use the same authenticated local API and persistent SQLite queue.
- User-configured AList-compatible source, JSON catalog and magnet/torrent imports.
- User-configured CD2 token, using its connected 115 account; no bundled CD2 or 115 credentials.
- Submission is not completion. Completion requires remote task success and file evidence.
- Durable deduplication; ambiguous submissions reconcile without automatic resubmission.
- Douban public watchlists: full pagination, baseline without historical downloads,
  subsequent incremental subscription, bounded polling, no captcha circumvention.
- Search-only works without configuring a downloader; no private source is required.
- Clean local install and Docker install, health check, documented recovery and CLI.
- Isolated integration tests, actual browser review, container smoke test, privacy audit.
- Prepare GitHub publication after repository identity is known.

## Sequence
1. Persistence, auth and security boundaries; failing behavioral tests first.
2. Public-protocol connectors, job engine and subscriptions.
3. Web and CLI, documentation, container and installer.
4. End-to-end verification, release audit and publication.

## Scope notes
Initial 115 support is through the user's CD2 connection. Authentication takes place in CD2.
No promise of unattended login to third-party services or complete access to private Douban lists.
No destructive cleanup, deleting media, built-in index scraping or outbound telemetry.
Name is a working title; license initially Apache-2.0, documented attribution for public protocols.

## Progress
- Planning: complete. New isolated repository created.
- Implementation: complete for the scoped 0.1 vertical slice.
- Verification: 22 tests pass, Chrome desktop flow checked, ARM64 Docker healthy.
- Publication: repository audit and release in progress; see VERIFICATION.md for explicit external-service gaps.
