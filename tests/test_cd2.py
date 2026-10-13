import importlib.util
from concurrent.futures import ThreadPoolExecutor

import grpc


def test_cd2_actual_grpc_wire_submission_and_completion():
    assert importlib.util.find_spec("cinebridge.cd2"), "CD2 adapter missing"
    from cinebridge.cd2 import CD2, MESSAGES

    server = grpc.server(ThreadPoolExecutor(max_workers=2))
    seen = []

    def offline(req, context):
        assert dict(context.invocation_metadata())["authorization"] == "Bearer test-token"
        seen.append((req.urls, req.toFolder))
        return MESSAGES["FileOperationResult"](success=True)

    def status(req, context):
        return MESSAGES["OfflineFileListResult"](
            offlineFiles=[MESSAGES["OfflineFile"](infoHash="ab" * 20, status=2, percendDone=100)]
        )

    def listing(req, context):
        yield MESSAGES["SubFilesReply"](
            subFiles=[
                MESSAGES["CloudDriveFile"](
                    name="Movie.mkv", fullPathName=req.path + "/Movie.mkv", size=123, isDirectory=False
                )
            ]
        )

    handlers = {
        "AddOfflineFiles": grpc.unary_unary_rpc_method_handler(
            offline,
            request_deserializer=MESSAGES["AddOfflineFileRequest"].FromString,
            response_serializer=lambda m: m.SerializeToString(),
        ),
        "ListOfflineFilesByPath": grpc.unary_unary_rpc_method_handler(
            status,
            request_deserializer=MESSAGES["FileRequest"].FromString,
            response_serializer=lambda m: m.SerializeToString(),
        ),
        "GetSubFiles": grpc.unary_stream_rpc_method_handler(
            listing,
            request_deserializer=MESSAGES["ListSubFileRequest"].FromString,
            response_serializer=lambda m: m.SerializeToString(),
        ),
    }
    server.add_generic_rpc_handlers(
        (grpc.method_handlers_generic_handler("clouddrive.CloudDriveFileSrv", handlers),)
    )
    port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    try:
        cd = CD2({"url": f"http://127.0.0.1:{port}", "token": "test-token"})
        cd.submit("magnet:?xt=urn:btih:" + "ab" * 20, "/115/Movies")
        assert seen[0][1] == "/115/Movies"
        assert cd.status("ab" * 20, "/115/Movies")["status"] == "finished"
        assert cd.media_files("/115/Movies")[0]["size"] == 123
        cd.close()
    finally:
        server.stop(0).wait()


def test_cd2_uses_pagination_instead_of_unbounded_legacy_listing():
    from cinebridge.cd2 import CD2, MESSAGES

    server = grpc.server(ThreadPoolExecutor(max_workers=2))
    seen = []

    def status(req, context):
        seen.append(req.page)
        return MESSAGES["OfflineFileListAllResult"](
            pageCount=2,
            offlineFiles=[]
            if req.page == 1
            else [MESSAGES["OfflineFile"](infoHash="ab" * 20, status=2, percendDone=100)],
        )

    handler = grpc.unary_unary_rpc_method_handler(
        status,
        request_deserializer=MESSAGES["OfflineFileListAllRequest"].FromString,
        response_serializer=lambda m: m.SerializeToString(),
    )
    server.add_generic_rpc_handlers(
        (
            grpc.method_handlers_generic_handler(
                "clouddrive.CloudDriveFileSrv", {"ListAllOfflineFiles": handler}
            ),
        )
    )
    port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    try:
        cd = CD2({"url": f"http://127.0.0.1:{port}", "token": "test"})
        assert cd.status("ab" * 20, "/115/Movies")["status"] == "finished"
        assert seen == [1, 2]
        cd.close()
    finally:
        server.stop(0).wait()
