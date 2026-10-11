"""Minimal wire-compatible client built from CD2's published protocol specification.

See docs/PROTOCOLS.md. The private application's source and protobuf files are not used.
Only required fields are declared; unknown protobuf fields are safely ignored.
"""

import posixpath
from urllib.parse import urlsplit

import grpc
from google.protobuf import descriptor_pb2, descriptor_pool, message_factory


def _messages():
    spec = descriptor_pb2.FileDescriptorProto(
        name="cinebridge_cd2.proto", package="clouddrive", syntax="proto3"
    )
    # field name, published wire number, scalar/message type; [] marks repetition.
    definitions = {
        "FileRequest": [("path", 1, "string")],
        "ListSubFileRequest": [("path", 1, "string"), ("forceRefresh", 2, "bool")],
        "AddOfflineFileRequest": [("urls", 1, "string"), ("toFolder", 2, "string")],
        "FileOperationResult": [("success", 1, "bool"), ("errorMessage", 2, "string")],
        "CreateFolderRequest": [("parentPath", 1, "string"), ("folderName", 2, "string")],
        "CreateFolderResult": [("folderCreated", 1, "CloudDriveFile"), ("result", 2, "FileOperationResult")],
        "CloudDriveFile": [
            ("name", 2, "string"),
            ("fullPathName", 3, "string"),
            ("size", 4, "int64"),
            ("isDirectory", 30, "bool"),
        ],
        "SubFilesReply": [("subFiles", 1, "CloudDriveFile[]")],
        "OfflineFile": [
            ("name", 1, "string"),
            ("size", 2, "uint64"),
            ("url", 3, "string"),
            ("status", 4, "uint32"),
            ("infoHash", 5, "string"),
            ("percendDone", 9, "double"),
        ],
        "OfflineFileListResult": [("offlineFiles", 1, "OfflineFile[]")],
    }
    scalar = {"string": 9, "bool": 8, "int64": 3, "uint64": 4, "uint32": 13, "double": 1}
    for name, fields in definitions.items():
        message = spec.message_type.add(name=name)
        for fname, number, kind in fields:
            repeat = kind.endswith("[]")
            kind = kind.removesuffix("[]")
            field = message.field.add(
                name=fname, number=number, label=3 if repeat else 1, type=scalar.get(kind, 11)
            )
            if kind not in scalar:
                field.type_name = ".clouddrive." + kind
    pool = descriptor_pool.DescriptorPool()
    pool.Add(spec)
    return {
        name: message_factory.GetMessageClass(pool.FindMessageTypeByName("clouddrive." + name))
        for name in definitions
    }


MESSAGES = _messages()
MEDIA_EXTENSIONS = {".mkv", ".mp4", ".avi", ".mov", ".m4v", ".ts", ".m2ts", ".iso", ".webm"}


class CD2:
    def __init__(self, config):
        url = urlsplit(config["url"])
        if url.scheme not in ("http", "https") or not url.hostname or url.path not in ("", "/"):
            raise ValueError("CD2 地址须包含协议和端口，不能包含路径")
        host = f"[{url.hostname}]" if ":" in url.hostname else url.hostname
        target = f"{host}:{url.port or (443 if url.scheme == 'https' else 80)}"
        self.channel = (
            grpc.secure_channel(target, grpc.ssl_channel_credentials())
            if url.scheme == "https"
            else grpc.insecure_channel(target)
        )
        self.metadata = [("authorization", "Bearer " + config.get("token", ""))]

    def close(self):
        self.channel.close()

    def call(self, method, request, response, stream=False, **fields):
        factory = self.channel.unary_stream if stream else self.channel.unary_unary
        rpc = factory(
            "/clouddrive.CloudDriveFileSrv/" + method,
            request_serializer=lambda m: m.SerializeToString(),
            response_deserializer=MESSAGES[response].FromString,
        )
        return rpc(MESSAGES[request](**fields), timeout=25, metadata=self.metadata)

    def ls(self, path):
        result = []
        for batch in self.call(
            "GetSubFiles", "ListSubFileRequest", "SubFilesReply", stream=True, path=path, forceRefresh=True
        ):
            for f in batch.subFiles:
                result.append(
                    {"name": f.name, "path": f.fullPathName, "size": f.size, "is_dir": f.isDirectory}
                )
            if len(result) > 20000:
                raise ValueError("目录条目过多，请使用独立入库目录")
        return result

    def prepare(self, folder):
        parent, name = posixpath.split(folder)
        if any(f["name"] == name and f["is_dir"] for f in self.ls(parent)):
            return
        result = self.call(
            "CreateFolder", "CreateFolderRequest", "CreateFolderResult", parentPath=parent, folderName=name
        )
        if not result.result.success:
            raise ValueError("CD2 创建任务目录失败，请检查目录和写入权限")

    def submit(self, magnet, folder):
        result = self.call(
            "AddOfflineFiles", "AddOfflineFileRequest", "FileOperationResult", urls=magnet, toFolder=folder
        )
        if not result.success:
            # Duplicate, quota and other provider errors can have side effects: reconcile first.
            raise ValueError("CD2 未确认任务提交，需要核对远端任务")

    def status(self, info_hash, folder):
        result = self.call("ListOfflineFilesByPath", "FileRequest", "OfflineFileListResult", path=folder)
        for f in result.offlineFiles:
            if f.infoHash.lower() == info_hash.lower():
                return {
                    "status": {0: "pending", 1: "downloading", 2: "finished", 3: "error"}.get(
                        f.status, "unknown"
                    ),
                    "progress": max(0, min(100, f.percendDone)),
                }
        return {"status": "unknown", "progress": 0}

    def media_files(self, folder):
        found, todo, scanned = [], [(folder, 0)], set()
        while todo:
            path, depth = todo.pop()
            if path in scanned:
                continue
            scanned.add(path)
            if len(scanned) > 200:
                raise ValueError("媒体目录超过验证上限")
            for f in self.ls(path):
                if not f["path"].startswith(folder.rstrip("/") + "/"):
                    continue
                if f["is_dir"] and depth < 5:
                    todo.append((f["path"], depth + 1))
                elif (
                    not f["is_dir"]
                    and f["size"] > 0
                    and posixpath.splitext(f["name"])[1].lower() in MEDIA_EXTENSIONS
                ):
                    found.append(f)
        return found
