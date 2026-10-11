# Architecture

```text
Browser / CLI
      |
Authenticated FastAPI API
      |
SQLite store + encrypted connections
      |
Single scheduler / durable task state machine
      |
Source adapters          Downloader adapter
AList / JSON / import    CD2 gRPC -> user's 115
      |
Public Douban watchlist -> baseline -> incremental watchlist -> search queue
```

The web app is bundled vanilla HTML/CSS/JS: no build server, CDN, analytics or
third-party asset requests. CLI calls the same API and does not start a second worker.
The backend uses one worker and a POSIX lock for exclusive ownership of a data
directory. Do not start Uvicorn with multiple workers against one data directory.

Tasks are unique by `(info_hash, downloader_id)`. Claiming uses a SQLite immediate
transaction before any side effects. Submission ambiguity is retained rather than
retried. Remote completion and nonempty media file evidence are stored separately.
Initial Douban ingestion and baseline flag update share a transaction.

Connection configuration is Fernet-encrypted as one value. The 0600 master key
stays outside the repository. API read responses omit service tokens; validation
errors do not echo submitted payloads. Store file paths and media resource names
are local user data; do not include them in public bug reports without review.

## Extensions

Source adapter contract: `search(query) -> list[resource]`, `resolve(resource) -> magnet`.
Download adapter contract: `prepare(folder)`, `submit(magnet,folder)`,
`status(info_hash,folder)`, `media_files(folder)`, `close()`.

Keep private integrations outside the public source repository. Do not load
arbitrary remote Python code through configuration. New public adapters need
isolated protocol tests and explicit secret-redaction handling.

## Release roadmap

0.1 is the conservative vertical slice. Separate future work: configurable quality
profiles, season/episode identity, TMDB metadata, notifications, external library
scan, direct 115 authorization, richer connection diagnostics, authenticated
multi-user operation. None is represented as already implemented.
