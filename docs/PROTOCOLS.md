# Public protocol references

The application is an independent implementation. No private program source,
credentials, resource index, protobuf module or configuration was imported.

- CloudDrive2 official developer guide: https://www.clouddrive2.com/api/CloudDrive2_gRPC_API_Guide.html
- Published CD2 wire schema: https://www.clouddrive2.com/api/clouddrive.proto
- AList filesystem API: https://alistgo.com/guide/api/fs
- BitTorrent v1 metainfo: https://www.bittorrent.org/beps/bep_0003.html

`cd2.py` declares only 10 necessary wire message shapes (23 fields) through the
protobuf descriptor API. Field names/numbers and RPC paths follow the public
protocol. This repository does not redistribute CD2 or its full generated SDK.
It uses user-created API tokens with `authorization: Bearer ...` metadata.

No standalone stable official Douban watchlist API is assumed. The optional
connector parses the user's public movie-list HTML, checks pagination and declared
counts when present, and aborts on access restrictions or structural failures.
There is no CAPTCHA solver, proxy rotation, shared cookie or private API relay.

AList-compatible services must expose `/api/fs/search` and `/api/fs/get` and have
an appropriate index. API tokens are never forwarded to torrent download URLs.
HTTP redirects are not followed automatically: configure the final service URL.

External services retain their respective names, software licenses and terms.
