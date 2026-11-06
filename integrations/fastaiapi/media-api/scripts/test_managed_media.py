"""Codex++ 托管连接、默认模型及音频扩展的离线回归。"""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import common
import media_api as api

class ManagedMediaTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        descriptor = patch.object(common, "MANAGED_DESCRIPTOR", Path(directory.name) / "connection.json")
        descriptor.start()
        self.addCleanup(descriptor.stop)
        patcher=patch.object(common,"managed_environment",side_effect=lambda name:os.environ.get(name))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_managed_environment_overrides_old_global_key_for_selected_route(self):
        descriptor = {"managed": True, "origin": "https://tumeiapi.com"}
        with patch.object(common,"managed_connection",return_value=descriptor), patch.dict(os.environ,{"FASTAIAPI_API_KEY":"sk-current","FASTAIAPI_GROK_API_KEY":"sk-current","FASTAIAPI_H3_API_KEY":"sk-current","FASTAIAPI_BASE_URL":"https://tumeiapi.com"},clear=True):
            for provider in ("main","grok","h3"):
                self.assertEqual(common.provider_origin(provider),"https://tumeiapi.com")
                self.assertEqual(common.load_key(provider),"sk-current")
                self.assertEqual(common.active_config(provider)[0],"managed-environment")

    def test_managed_job_can_use_another_route_of_the_same_backend(self):
        with tempfile.TemporaryDirectory() as directory:
            run=Path(directory)/"run"
            with patch.object(common,"managed_connection",return_value={"managed":True,"origin":common.MANAGED_ORIGINS[0]}):
                api.prepare_run(run,api.image_request("gpt-image-2","test"))
            for origin in common.MANAGED_ORIGINS[1:]:
                with patch.object(common,"managed_connection",return_value={"managed":True,"origin":origin}):
                    path,record,body=api.read_run(run,verify_body=True)
                    self.assertEqual(record["origin"],common.MANAGED_ORIGINS[0])

    def test_image_url_is_downloaded_and_recoverable_without_paid_resubmission(self):
        with tempfile.TemporaryDirectory() as directory:
            run=Path(directory)/"run"
            api.prepare_run(run,api.image_request("gpt-image-2","test"))
            png=b"\x89PNG\r\n\x1a\nfixture"
            def download(url,destination,key=None,**kwargs):
                Path(destination).write_bytes(png)
                return {"path":str(destination),"bytes":len(png)}
            with patch.object(common,"load_key",return_value="sk-test"),patch.object(common,"api_request",return_value={"data":[{"url":"https://cdn.example/image.png"}]}),patch.object(common,"download_file",side_effect=download):
                result=api.submit(run)
                self.assertEqual(result["state"],"downloaded")
                self.assertEqual(Path(result["files"][0]["path"]).read_bytes(),png)
            self.assertTrue((run/"response.json").is_file())

    def test_wrong_route_never_sends_environment_key(self):
        with patch.object(common,"managed_connection",return_value={"origin":"https://tumeiapi.com"}), patch.dict(os.environ,{"FASTAIAPI_API_KEY":"sk-other","FASTAIAPI_BASE_URL":"http://8.137.194.180:90"},clear=True):
            with self.assertRaisesRegex(common.MediaError,"一键修复"):
                common.load_key("main")

    def test_video_defaults_to_h3_and_explicit_model_wins(self):
        args=api.parser().parse_args(["prepare","--prompt-file","prompt.txt","--run","test"])
        self.assertEqual(args.model,"minimax-h3")
        args=api.parser().parse_args(["prepare","--model","grok","--prompt-file","prompt.txt","--run","test"])
        self.assertEqual(args.model,"grok")

    def test_newapi_h3_prepares_native_reference_protocol_with_default_resolution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / "reference.png"
            image.write_bytes(b"\x89PNG\r\n\x1a\nfixture")
            prompt = root / "prompt.txt"
            prompt.write_text("<Picture 1> robot waves once.")
            args = api.parser().parse_args(["prepare", "--prompt-file", str(prompt), "--run", str(root / "run"),
                                           "--duration", "5", "--image", str(image)])
            with patch.object(common, "managed_connection", return_value={"platform":"newapi", "origin":"https://tumeiapi.com"}):
                body = json.loads(api.build_from_args(args))
            self.assertEqual(body["model"], "minimax-h3")
            self.assertEqual(body["seconds"], 5)
            self.assertEqual(body["size"], "864x480")
            self.assertIn("<Picture 1>", body["prompt"])
            self.assertTrue(body["reference_images"][0].startswith("data:image/png;base64,"))
            self.assertNotIn("content", body)
            args.resolution = "720p"
            with patch.object(common, "managed_connection", return_value={"platform":"newapi"}), self.assertRaisesRegex(ValueError, "480p, 768p or 1080p"):
                api.build_from_args(args)

    def test_newapi_h3_submits_once_and_downloads_authenticated_content(self):
        import h3
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            descriptor = {"platform":"newapi", "origin":"https://tumeiapi.com"}
            body = h3.build_newapi_request("<Picture 1> robot waves.", duration=5, ratio="9:16",
                                           images=["https://example.com/robot.png"], audios=["https://example.com/a.wav"])
            self.assertEqual(json.loads(body)["size"], "480x864")
            self.assertEqual(json.loads(body)["reference_audios"], ["https://example.com/a.wav"])
            run = root / "run"
            with patch.object(common, "managed_connection", return_value=descriptor), patch.object(common, "load_key", return_value="fixture-key"), patch.object(common, "api_request") as remote, patch.object(common, "download_file", return_value={"path":str(root / "video.mp4"),"bytes":10}) as fetch:
                api.prepare_run(run, body)
                remote.return_value = {"id":"task-1", "status":"queued"}
                api.submit(run)
                api.submit(run)
                self.assertEqual(remote.call_count, 1)
                remote.return_value = {"id":"task-1", "status":"completed", "content_url":"/v1/videos/task-1/content"}
                api.download(run, root / "video.mp4")
                fetch.assert_called_once_with("https://tumeiapi.com/v1/videos/task-1/content", root / "video.mp4", "fixture-key", provider="h3")

    def test_newapi_h3_external_output_never_receives_key(self):
        import h3
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(common, "managed_connection", return_value={"platform":"newapi", "origin":"https://tumeiapi.com"}), patch.object(common, "load_key", return_value="fixture-key"), patch.object(common, "api_request") as remote, patch.object(common, "download_file", return_value={"path":str(root / "video.mp4"),"bytes":10}) as fetch:
                api.prepare_run(root / "run", h3.build_newapi_request("Robot waves.", duration=5, ratio="16:9", images=["https://example.com/robot.png"]))
                remote.return_value = {"id":"task-1", "status":"queued"}
                api.submit(root / "run")
                remote.return_value = {"id":"task-1", "status":"completed", "output_url":"https://cdn.example/video.mp4"}
                api.download(root / "run", root / "video.mp4")
                fetch.assert_called_once_with("https://cdn.example/video.mp4", root / "video.mp4")

    def test_newapi_h3_rejects_unsupported_references_without_network(self):
        import h3
        with self.assertRaisesRegex(ValueError, "reference video"):
            h3.build_newapi_request("test", duration=5, ratio="16:9", images=["https://example.com/a.png"], videos=["https://example.com/a.mp4"])
        with self.assertRaisesRegex(ValueError, "at least one reference image"):
            h3.build_newapi_request("test", duration=5, ratio="16:9")

    def test_audio_success_has_durable_receipt_without_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); text=root/"speech.txt"; text.write_text("Hello")
            raw=b"RIFF"+b"1234"+b"WAVE"+b"audio"
            with patch.object(common,"load_key",return_value="sk-private"), patch.object(common,"audio_request",return_value=raw):
                result=api.audio_generate("tts-test",text,root/"speech.wav")
                self.assertEqual(result["state"],"downloaded")
                self.assertEqual((root/"speech.wav").read_bytes(),raw)
                self.assertNotIn("sk-private",(root/"speech.wav.receipt.json").read_text())

    def test_uncertain_audio_submission_cannot_be_repeated(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); text=root/"speech.txt"; text.write_text("Hello")
            with patch.object(common,"load_key",return_value="sk-private"), patch.object(common,"audio_request",side_effect=common.MediaError("network")) as remote:
                with self.assertRaises(common.MediaError):api.audio_generate("tts-test",text,root/"speech.wav")
                with self.assertRaises(common.MediaError):api.audio_generate("tts-test",text,root/"speech.wav")
                self.assertEqual(remote.call_count,1)
                self.assertEqual(common.read_json(root/"speech.wav.receipt.json")["state"],"submission_unknown")


class PlatformIsolationTests(unittest.TestCase):
    def test_job_cannot_cross_panels_but_can_change_newapi_route(self):
        with tempfile.TemporaryDirectory() as directory:
            run=Path(directory)/"run"
            with patch.object(common,"managed_connection",return_value={"managed":True,"platform":"newapi","origin":"https://tumeiapi.com"}):
                api.prepare_run(run,api.image_request("gpt-image-2","test"))
            with patch.object(common,"managed_connection",return_value={"managed":True,"platform":"subapi","origin":"https://fastaiapi.cloud"}):
                with self.assertRaisesRegex(common.MediaError,"another origin"):
                    api.read_run(run)
    def test_descriptor_rejects_cross_panel_origin_and_service(self):
        with patch.object(common,"MANAGED_DESCRIPTOR") as file, patch.object(common,"read_json",return_value={"managed":True,"platform":"subapi","origin":"https://tumeiapi.com","service":"com.fastaiapi.codexplusplus.subapi.media"}):
            file.is_file.return_value=True
            with self.assertRaises(common.MediaError): common.managed_connection()
        with patch.object(common,"MANAGED_DESCRIPTOR") as file, patch.object(common,"read_json",return_value={"managed":True,"platform":"subapi","origin":"https://fastaiapi.cloud","service":"com.fastaiapi.codexplusplus.newapi.media"}):
            file.is_file.return_value=True
            with self.assertRaises(common.MediaError): common.managed_connection()

if __name__ == "__main__":unittest.main()
