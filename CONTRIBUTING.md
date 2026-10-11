# Contributing

Use a fresh data directory and fake resources for development. Do not test against
someone else's cloud account or resource endpoint. Keep patches scoped and include
behavioral tests for changes in parsing, submission, persistence or authorization.

Run `pytest -q`, `ruff check cinebridge tests`, and `node --check cinebridge/static/app.js`.
Do a browser check for visible UI changes. Document which upstream versions and
flows were actually tested; mocked protocol success is not production-account success.

Never commit tokens, cookies, user databases, local paths, private hostnames or
logs from an existing deployment. Docker's build context is explicitly allowlisted.
Code and documentation contributions are licensed under Apache-2.0.
