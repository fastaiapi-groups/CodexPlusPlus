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

if __name__ == "__main__":unittest.main()
