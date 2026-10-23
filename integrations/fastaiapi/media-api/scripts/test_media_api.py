"""Offline behavior tests. All transport calls are mocked; no credentials or network needed."""
import base64
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

import common
import grok
import h3
import media_api as api


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.image = self.root / "reference.png"
        self.png = b"\x89PNG\r\n\x1a\nfixture"
        self.image.write_bytes(self.png)
        self.prompt = self.root / "prompt.txt"
        self.prompt.write_text("A camera slowly pushes in on a cup of tea.")

    def tearDown(self):
        self.temp.cleanup()

    def video_run(self, model="minimax-h3", name="run"):
        body = (h3.build_request("A cup of tea.", duration=10, ratio="9:16", resolution="720p", images=[str(self.image)])
                if model == "minimax-h3" else
                grok.build_request("A cup of tea.", mode="first-frame", duration=12)[0])
        run = self.root / name
        api.prepare_run(run, body)
        return run

    def read_receipt(self, run):
        return common.read_json(run / "receipt.json")

    def test_provider_environment_credentials_do_not_fall_back(self):
        with patch.object(common, "project_config_path", return_value=None), \
             patch.object(common, "config_path", return_value=self.root / "missing"), \
             patch.dict(os.environ, {"FASTAIAPI_API_KEY": "main-secret", "FASTAIAPI_H3_API_KEY": "h3-secret", "FASTAIAPI_GROK_API_KEY": "grok-secret"}, clear=True):
            self.assertEqual(common.load_key("main"), "main-secret")
            self.assertEqual(common.load_key("h3"), "h3-secret")
            self.assertEqual(common.load_key("grok"), "grok-secret")
            del os.environ["FASTAIAPI_H3_API_KEY"]
            with self.assertRaises(common.MediaError):
                common.load_key("h3")

    def test_separate_configure_does_not_overwrite_other_provider(self):
        def config(name="fastaiapi-media"):
            return self.root / name / "config.json"
        with patch.object(common, "config_path", side_effect=config), \
             patch.object(common.Path, "cwd", return_value=self.root), patch.dict(os.environ, {}, clear=True):
            for provider in ("main", "grok", "h3"):
                incoming = self.root / "incoming"
                incoming.write_text(provider + "-secret")
                common.configure(key_file=incoming, provider=provider)
            self.assertEqual(common.load_key("main"), "main-secret")
            self.assertEqual(common.load_key("h3"), "h3-secret")
            self.assertEqual(common.load_key("grok"), "grok-secret")

    def test_every_model_submit_and_query_use_correct_provider(self):
        for model in api.MODELS:
            provider = "h3" if model == "minimax-h3" else "grok" if model == "grok-imagine-video-1.5" else "main"
            run = self.root / model
            if model in api.IMAGE_MODELS:
                api.prepare_run(run, api.image_request(model, "prompt"))
                result = {"data": [{"b64_json": base64.b64encode(self.png).decode()}]}
            else:
                run = self.video_run(model, name=model)
                result = {"id": "task-1"}
            with patch.object(common, "load_key", return_value="secret") as load, \
                 patch.object(common, "api_request", return_value=result) as remote:
                api.submit(run)
                load.assert_called_with(provider)
                self.assertEqual(remote.call_args.kwargs["provider"], provider)
                self.assertFalse(remote.call_args.kwargs["retry"])
                if model in api.VIDEO_MODELS:
                    remote.return_value = {"status": "running"}
                    api.status(run)
                    self.assertEqual(remote.call_args.kwargs["provider"], provider)

    def test_transport_origin_and_header_for_both_providers(self):
        for provider, origin in (("main", "https://fastaiapi.cloud"), ("grok", "https://fastaiapi.cloud"), ("h3", "https://newapi.fastaiapi.cloud")):
            with patch.object(common, "opener") as client:
                client.return_value.open.return_value = io.BytesIO(b'{"data":[]}')
                common.api_request("GET", "/v1/models", provider + "-secret", provider=provider)
                request = client.return_value.open.call_args.args[0]
                self.assertEqual(request.full_url, origin + "/v1/models")
                self.assertEqual(request.get_header("Authorization"), "Bearer " + provider + "-secret")
        with self.assertRaises(common.MediaError):
            common.download_file(common.H3_ORIGIN + "/v1/videos/a/content", self.root / "x", "main-secret")

    def test_receipt_cannot_switch_provider_or_import_old_job(self):
        run = self.video_run()
        record = self.read_receipt(run)
        record["origin"] = common.ORIGIN
        api.save_record(run, record)
        with patch.object(common, "api_request") as send:
            with self.assertRaises(common.MediaError):
                api.submit(run, key="secret")
            record["schema"] = 1
            api.save_record(run, record)
            with self.assertRaises(common.MediaError):
                api.status(run, key="secret")
            send.assert_not_called()

    def test_image_models_differ_only_in_model(self):
        bodies = [json.loads(api.image_request(m, "Exact text", "1440x2560", [self.image]))
                  for m in api.IMAGE_MODELS]
        self.assertNotEqual(bodies[0].pop("model"), bodies[1].pop("model"))
        self.assertEqual(bodies[0], bodies[1])
        self.assertEqual(bodies[0]["n"], 1)
        self.assertTrue(bodies[0]["images"][0].startswith("data:image/png;base64,"))

    def test_image_reference_limit(self):
        with self.assertRaises(common.MediaError):
            api.image_request("gpt-image-2.5", "test", references=[self.image] * 5)

    def test_image_routing_and_saved_bytes(self):
        for index, refs in enumerate(([], [self.image])):
            run = self.root / f"image-{index}"
            api.prepare_run(run, api.image_request("gpt-image-2.5", "prompt", references=refs))
            response = {"data": [{"b64_json": base64.b64encode(self.png).decode()}]}
            with patch.object(common, "api_request", return_value=response) as send:
                result = api.submit(run, key="fake")
                self.assertEqual(send.call_args.args[1], "/v1/images/edits" if refs else "/v1/images/generations")
                self.assertFalse(send.call_args.kwargs["retry"])
            self.assertEqual(Path(result["files"][0]["path"]).read_bytes(), self.png)

    def test_h3_reference_bindings_and_limits(self):
        body = json.loads(h3.build_request("<Picture 1> and <Audio 1>", duration=1, ratio="9:16",
                         resolution="720p", images=[str(self.image)], audios=["https://example.com/a.mp3"]))
        self.assertEqual(body["duration"], 1)
        self.assertIn("<Audio 1> corresponds to @音频1", body["content"][0]["text"])
        self.assertEqual(body["content"][2]["role"], "reference_audio")
        with self.assertRaises(ValueError):
            h3.build_request("<Picture 2>", duration=10, ratio="9:16", resolution="720p", images=[str(self.image)])
        for duration in (0, 16, 1.5, True):
            with self.assertRaises(ValueError):
                h3.build_request("prompt", duration=duration, ratio="9:16", resolution="720p")
        for resolution in ("2k", "2K"):  # 2k is currently unsupported by the service
            with self.assertRaises(ValueError):
                h3.build_request("prompt", duration=5, ratio="9:16", resolution=resolution, images=[str(self.image)])

    def test_h3_six_fields_are_inside_single_text(self):
        prompt_path = self.root / "prompt.json"
        data = {name: [] if name in h3.ARRAY_FIELDS else "text" for name in h3.PROMPT_FIELDS}
        prompt_path.write_text(json.dumps(data))
        body = json.loads(h3.build_request(h3.read_prompt(prompt_path), duration=10, ratio="16:9", resolution="720p", images=[str(self.image)]))
        self.assertNotIn("subject_definitions", body)
        self.assertEqual(json.loads(body["content"][0]["text"].split("\n\n", 1)[1]), data)

    def test_grok_modes_are_distinct(self):
        first = json.loads(grok.build_request("prompt", mode="first-frame", duration=30, images=[str(self.image)])[0])
        ref = json.loads(grok.build_request("prompt", mode="reference", duration=6, images=[str(self.image)])[0])
        self.assertIn("image", first)
        self.assertNotIn("reference_images", first)
        self.assertNotIn("mode", first)
        self.assertIn("reference_images", ref)
        self.assertNotIn("image", ref)
        with self.assertRaises(ValueError):
            grok.build_request("prompt", mode="reference", duration=12)

    def test_h3_request_budget(self):
        with patch.object(h3, "MAX_REQUEST_BYTES", 10):
            with self.assertRaises(ValueError):
                h3.build_request("prompt", duration=10, ratio="16:9", resolution="720p", images=["https://example.com/reference.png"])

    def test_h3_rejects_no_image_even_with_other_media(self):
        for references in ({}, {"videos": ["https://example.com/ref.mp4"]},
                           {"audios": ["https://example.com/ref.mp3"]}):
            with self.assertRaisesRegex(ValueError, "requires at least one reference image"):
                h3.build_request("optimized prompt", duration=5, ratio="16:9", resolution="720p", **references)

    def test_h3_old_text_only_request_cannot_be_submitted(self):
        body = common.json_bytes({"model": "minimax-h3", "content": [{"type": "text", "text": "old prompt"}],
                                  "duration": 5, "ratio": "16:9", "resolution": "720p"})
        run = self.root / "legacy-text-only"
        api.prepare_run(run, body)
        with patch.object(common, "api_request") as remote:
            with self.assertRaisesRegex(common.MediaError, "requires a reference image"):
                api.submit(run, key="fake")
            remote.assert_not_called()
        self.assertEqual(self.read_receipt(run)["state"], "prepared")

    def test_prepare_is_offline_and_refuses_overwrite(self):
        with patch.object(common, "load_key", side_effect=AssertionError("must not read keys")), \
             patch.object(common, "api_request", side_effect=AssertionError("must not call network")):
            args = api.parser().parse_args(["prepare", "--model", "grok", "--mode", "first-frame",
                                           "--duration", "12", "--prompt-file", str(self.prompt),
                                           "--run", str(self.root / "offline")])
            result = api.prepare_run(args.run, api.build_from_args(args))
            self.assertEqual(result["model"], "grok-imagine-video-1.5")
            with self.assertRaises(FileExistsError):
                api.prepare_run(args.run, api.build_from_args(args))

    def test_model_specific_arguments_are_not_silently_ignored(self):
        args = api.parser().parse_args(["prepare", "--model", "gpt-image-2", "--ratio", "9:16",
                                       "--prompt-file", str(self.prompt), "--run", str(self.root / "bad")])
        with self.assertRaises(common.MediaError):
            api.build_from_args(args)

    def test_durable_intent_precedes_post_and_repeat_submit_does_not_post(self):
        run = self.video_run()
        def remote(*args, **kwargs):
            self.assertEqual(self.read_receipt(run)["state"], "submitting")
            self.assertEqual(args[4]["Idempotency-Key"], self.read_receipt(run)["idempotency_key"])
            return {"id": "public-1"}
        with patch.object(common, "api_request", side_effect=remote) as send:
            first = api.submit(run, key="fake")
            second = api.submit(run, key="fake")
        self.assertEqual(first, second)
        self.assertEqual(send.call_count, 1)
        self.assertEqual(self.read_receipt(run)["job_id"], "public-1")

    def test_h3_unknown_submission_is_not_reposted(self):
        run = self.video_run()
        with patch.object(common, "api_request", side_effect=common.MediaError("timeout")) as send:
            with self.assertRaises(common.MediaError):
                api.submit(run, key="fake")
            self.assertFalse(send.call_args.kwargs["retry"])
            with self.assertRaises(common.MediaError):
                api.submit(run, key="fake", retry_ambiguous=True)
            self.assertEqual(send.call_count, 1)
        self.assertEqual(self.read_receipt(run)["state"], "submission_unknown")

    def test_grok_never_reposts_unknown_submission(self):
        run = self.video_run("grok-imagine-video-1.5")
        with patch.object(common, "api_request", side_effect=common.MediaError("timeout")) as send:
            with self.assertRaises(common.MediaError):
                api.submit(run, key="fake")
            self.assertFalse(send.call_args.kwargs["retry"])
            with self.assertRaises(common.MediaError):
                api.submit(run, key="fake", retry_ambiguous=True)
            self.assertEqual(send.call_count, 1)
        with patch.object(common, "api_request", return_value={"id": "public-g", "status": "running"}):
            result = api.status(run, recover_job_id="public-g", key="fake")
        self.assertEqual(result["job_id"], "public-g")

    def test_changed_request_cannot_reuse_idempotency_key(self):
        run = self.video_run()
        (run / "request.json").write_text("{}")
        with patch.object(common, "api_request") as remote:
            with self.assertRaises(common.MediaError):
                api.submit(run, key="fake")
            remote.assert_not_called()

    def test_parallel_submit_is_blocked(self):
        run = self.video_run()
        with common.lock_run(run), patch.object(common, "api_request") as remote:
            with self.assertRaises(common.MediaError):
                api.submit(run, key="fake")
            remote.assert_not_called()

    def test_failed_and_unknown_status_do_not_resubmit(self):
        run = self.video_run()
        with patch.object(common, "api_request", return_value={"id": "one"}):
            api.submit(run, key="fake")
        with patch.object(common, "api_request", return_value={"status": "failed", "error": {"message": "private"}}) as send:
            self.assertEqual(api.status(run, key="fake")["state"], "failed")
            self.assertEqual(send.call_args.args[0], "GET")
        with patch.object(common, "api_request", return_value={"status": "mystery"}):
            with self.assertRaises(common.MediaError):
                api.status(run, key="fake")
        self.assertEqual(self.read_receipt(run)["state"], "failed")

    def test_wait_timeout_preserves_job(self):
        run = self.video_run()
        with patch.object(common, "api_request", return_value={"id": "one"}):
            api.submit(run, key="fake")
        with patch.object(common, "load_key", return_value="fake"), \
             patch.object(common, "api_request", return_value={"status": "running"}) as send:
            result = api.wait_for_job(run, timeout=0)
            self.assertTrue(result["wait_expired"])
            self.assertEqual(send.call_args.args[0], "GET")
        self.assertEqual(self.read_receipt(run)["job_id"], "one")

    def test_model_specific_download_auth(self):
        for model in api.VIDEO_MODELS:
            run = self.video_run(model, name=model)
            with patch.object(common, "api_request", return_value={"id": "job/x"}):
                api.submit(run, key="fake")
            with patch.object(common, "load_key", return_value="fake"), \
                 patch.object(common, "api_request", return_value={"status": "succeeded", "output_url": "https://cdn.example/result.mp4"}), \
                 patch.object(common, "download_file", return_value={"path": str(self.root / "video.mp4"), "bytes": 42}) as fetch:
                api.download(run, self.root / "video.mp4")
                if model == "minimax-h3":
                    self.assertEqual(len(fetch.call_args.args), 2)
                    self.assertEqual(fetch.call_args.args[0], "https://cdn.example/result.mp4")
                else:
                    self.assertEqual(fetch.call_args.args[0], common.ORIGIN + "/v1/videos/job%2Fx/content")
                    self.assertEqual(fetch.call_args.args[2], "fake")

    def test_cross_origin_redirect_strips_authorization(self):
        handler = common.SafeRedirect()
        req = urllib.request.Request(common.ORIGIN + "/v1/videos/x/content", headers={"Authorization": "Bearer secret"})
        same = handler.redirect_request(req, None, 302, "Found", {}, common.ORIGIN + "/download")
        external = handler.redirect_request(req, None, 302, "Found", {}, "https://cdn.example/v.mp4")
        self.assertEqual(same.get_header("Authorization"), "Bearer secret")
        self.assertIsNone(external.get_header("Authorization"))
        with self.assertRaises(common.MediaError):
            handler.redirect_request(req, None, 302, "Found", {}, "http://cdn.example/v.mp4")

    def test_post_redirect_not_followed(self):
        req = urllib.request.Request(common.ORIGIN + "/v1/videos", data=b"{}", method="POST")
        with self.assertRaises(common.MediaError):
            common.SafeRedirect().redirect_request(req, None, 307, "redirect", {}, "https://other.example/post")

    def test_external_download_cannot_receive_key(self):
        with self.assertRaises(common.MediaError):
            common.download_file("https://cdn.example/a.mp4", self.root / "a.mp4", "fake")

    def test_independent_credentials_and_no_legacy_import(self):
        with self.assertRaises(common.MediaError):
            common.configure(import_legacy=True)

    def test_key_file_is_saved_then_deleted_and_wins_over_environment(self):
        own = self.root / "own" / "config.json"
        key_file = self.root / "incoming-key.txt"
        key_file.write_bytes("﻿Bearer test-secret\r\n".encode("utf-8"))  # Windows BOM + CRLF
        with patch.object(common, "config_path", return_value=own), \
                patch.dict(os.environ, {"FASTAIAPI_API_KEY": "sk-stale"}, clear=True), \
                patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(common.load_key(), "sk-stale")
            self.assertEqual(common.key_source(), "environment")
            self.assertEqual(api.main(["configure", "--key-file", str(key_file)]), 0)
            self.assertFalse(key_file.exists())
            self.assertEqual(common.load_key(), "test-secret")
            self.assertEqual(common.key_source(), "global")

    def test_sandboxed_global_write_falls_back_to_project_folder(self):
        own = self.root / "global" / "config.json"
        project = self.root / "project"
        project.mkdir()
        real_save = common.save_global
        with patch.object(common, "config_path", return_value=own), \
                patch.object(common, "save_global", side_effect=PermissionError("sandbox")), \
                patch.object(common.Path, "cwd", return_value=project), \
                patch.dict(os.environ, {}, clear=True):
            key_file = project / ".media-api-key.txt"
            key_file.write_text("sk-project-secret")
            result = common.configure(key_file=key_file)
            self.assertEqual(result["scope"], "project")
            self.assertFalse(key_file.exists())
            self.assertFalse(own.exists())
            self.assertIn("*", (project / ".fastaiapi-media" / ".gitignore").read_text())
            self.assertEqual(common.load_key(), "sk-project-secret")
            self.assertEqual(common.key_source(), "project")
            # A later unsandboxed save refreshes the project copy so it cannot shadow the new key.
            with patch.object(common, "save_global", side_effect=real_save):
                key_file.write_text("sk-newer")
                self.assertEqual(common.configure(key_file=key_file)["scope"], "global")
            self.assertEqual(common.load_key(), "sk-newer")
            self.assertEqual(common.normalize_key(common.read_json(own)["api_key"]), "sk-newer")

    def test_both_locations_blocked_reports_permission_hint(self):
        with patch.object(common, "save_global", side_effect=PermissionError("sandbox")), \
                patch.object(common, "save_project", side_effect=PermissionError("sandbox")):
            key_file = self.root / "k.txt"
            key_file.write_text("sk-x")
            with self.assertRaises(common.MediaError) as caught:
                common.configure(key_file=key_file)
        self.assertIn("权限", str(caught.exception))
        self.assertFalse(key_file.exists())

    def test_network_and_auth_errors_are_actionable(self):
        with patch.object(common, "opener") as client:
            client.return_value.open.side_effect = urllib.error.URLError("blocked")
            with self.assertRaises(common.MediaError) as caught:
                common.api_request("GET", "/v1/models?type=all", "sk-x")
        self.assertIn("网络", str(caught.exception))
        self.assertIn("Key", str(common.HttpError(401)))

    def test_invalid_key_file_is_still_deleted(self):
        own = self.root / "own" / "config.json"
        key_file = self.root / "incoming-key.txt"
        key_file.write_text("  \n")
        with patch.object(common, "config_path", return_value=own):
            with self.assertRaises(common.MediaError):
                common.configure(key_file=key_file)
        self.assertFalse(key_file.exists())
        self.assertFalse(own.exists())

    def test_error_does_not_print_payload_or_key(self):
        error = urllib.error.HTTPError(common.ORIGIN, 400, "secret", {}, io.BytesIO(b"sk-private data:image/png;base64,private"))
        with patch.object(common, "opener") as client:
            client.return_value.open.side_effect = error
            with self.assertRaises(common.HttpError) as caught:
                common.api_request("POST", "/v1/videos", "sk-private", b"{}")
        self.assertNotIn("private", str(caught.exception))

    def test_transport_retries_h3_with_same_key_and_honors_retry_after(self):
        response = io.BytesIO(b'{"id":"public-1"}')
        throttled = urllib.error.HTTPError(common.ORIGIN, 429, "busy", {"Retry-After": "3"}, io.BytesIO(b"{}"))
        with patch.object(common, "opener") as client, patch.object(common.time, "sleep") as sleep:
            client.return_value.open.side_effect = [throttled, response]
            value = common.api_request("POST", "/v1/videos", "fake", b"{}", {"Idempotency-Key": "stable"}, retry=True)
            self.assertEqual(value["id"], "public-1")
            sleep.assert_called_once_with(3)
            for call in client.return_value.open.call_args_list:
                self.assertEqual(call.args[0].get_header("Idempotency-key"), "stable")
                self.assertEqual(call.args[0].data, b"{}")

    def test_transport_does_not_retry_unprotected_post(self):
        with patch.object(common, "opener") as client:
            client.return_value.open.side_effect = urllib.error.URLError("timeout")
            with self.assertRaises(common.MediaError):
                common.api_request("POST", "/v1/videos", "fake", b"{}")
            self.assertEqual(client.return_value.open.call_count, 1)

    def test_failed_job_error_body_remains_a_status_response(self):
        with patch.object(common, "opener") as client:
            client.return_value.open.return_value = io.BytesIO(b'{"status":"failed","error":{"message":"private"}}')
            result = common.api_request("GET", "/v1/videos/one", "fake")
            self.assertEqual(result["status"], "failed")

    def test_download_saves_bytes_and_refuses_overwrite(self):
        raw = b"\x00\x00\x00\x18ftypmp42fixture"
        response = io.BytesIO(raw)
        response.headers = {"Content-Type": "video/mp4", "Content-Length": str(len(raw))}
        output = self.root / "output.mp4"
        with patch.object(common, "opener") as client:
            client.return_value.open.return_value = response
            result = common.download_file("https://cdn.example/out.mp4", output)
            self.assertEqual(output.read_bytes(), raw)
            self.assertEqual(result["bytes"], len(raw))
            self.assertIsNone(client.return_value.open.call_args.args[0].get_header("Authorization"))
            with self.assertRaises(common.MediaError):
                common.download_file("https://cdn.example/out.mp4", output)
            self.assertEqual(output.read_bytes(), raw)

    def test_download_length_mismatch_retains_partial(self):
        response = io.BytesIO(b"incomplete")
        response.headers = {"Content-Type": "video/mp4", "Content-Length": "100"}
        output = self.root / "short.mp4"
        with patch.object(common, "opener") as client:
            client.return_value.open.return_value = response
            with self.assertRaises(common.MediaError):
                common.download_file("https://cdn.example/out.mp4", output)
        self.assertFalse(output.exists())
        self.assertEqual(output.with_suffix(".mp4.part").read_bytes(), b"incomplete")

    def test_partial_image_batch_preserves_success(self):
        args = api.parser().parse_args(["image", "--model", "gpt-image-2.5", "--prompt-file", str(self.prompt),
                                       "--count", "2", "--concurrency", "1", "--output-dir", str(self.root / "batch")])
        response = {"data": [{"b64_json": base64.b64encode(self.png).decode()}]}
        with patch.object(common, "load_key", return_value="fake"), patch.object(api.time, "sleep"), \
             patch.object(common, "api_request", side_effect=[response, common.MediaError("failure")]):
            result = api.image_batch(args)
        self.assertEqual(result["generated"], 1)
        self.assertEqual(result["requested"], 2)
        self.assertTrue(Path(result["runs"][0]["files"][0]["path"]).is_file())


if __name__ == "__main__":
    unittest.main()
