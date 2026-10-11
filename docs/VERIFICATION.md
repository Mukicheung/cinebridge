# 0.1.0 verification

## Verified locally

- 22 automated tests: canonical magnet deduplication, original torrent info hashing,
  encryption/redaction, atomic claiming, ambiguous submission recovery, AList pagination,
  Douban pagination/declared counts/access challenges, conservative title/year matching,
  authenticated API, cross-origin rejection, CLI, and actual local gRPC transport.
- Network acceptance: isolated HTTP catalog -> Web API -> CD2-protocol gRPC test
  server -> restart -> successful task plus file evidence -> library. Exactly one submit.
- Minimal CD2 client's 10 message definitions / 23 fields compared with the current
  officially published protobuf descriptor. This verifies protocol shape, not a live account.
- Chrome desktop: login, dashboard rendering, import dialog, imported magnet appearing
  in search results with parsed title/year/resolution. No fake statistics in the normal app.
- Docker image builds on Linux ARM64, unprivileged container reaches healthy state;
  CLI can query the same running server with its generated local credential.
- All 22 tests also pass inside the built Linux ARM64 / Python 3.13 image.
- Container restart preserves its access credential and data volume, then returns a valid authenticated response.
- Container runtime UID is 10001; data volume is writable and application/root filesystem is not.
- Python lint, syntax compilation and JavaScript syntax checks pass.
- Release file audit and a separate private deployment marker scan both pass.

## Explicitly not verified / limitations

- No private production endpoint, credential or legacy database was attached.
- No real 115 cloud download was started. CD2 production account permissions, quota,
  availability and version compatibility require an authorized integration check.
- Live unauthenticated Douban access returned HTTP 418 in the verification environment.
  The connector's parsers and fail-closed behavior pass fixture tests; live watchlist
  synchronization is not claimed to work from this network.
- Full mobile browser visual review and Windows host testing remain pending.
- Filesystem presence verification is not a media decode or full-content checksum test.

See the GitHub Actions results for checks on the exact published commit. Do not
interpret an isolated test server as third-party production acceptance.
