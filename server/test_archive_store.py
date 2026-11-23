import os
import json
import tempfile
import unittest
from unittest.mock import patch

from server.archive_store import ArchiveStore, topic_graph


class TopicGraphTests(unittest.TestCase):
    def test_filters_caption_filler_but_keeps_recurring_subjects(self):
        rows = [(json.dumps({"id": str(i), "title": str(i)}), json.dumps([
            {"start": 0, "text": "Please please. Totally different. Years ago. I don’t want a pro tip."},
            {"start": 2, "text": "Usage rights are distinct from intellectual property."},
            {"start": 20, "text": "Brand brand."},
            {"start": 40, "text": "Deals."},
        ])) for i in range(4)]
        terms = {node["term"] for node in topic_graph(rows)["topics"]}
        self.assertTrue({"usage rights", "intellectual property"} <= terms)
        self.assertTrue({"please please", "totally different", "years ago", "don twant",
                         "pro tip", "brand brand", "brand deals"}.isdisjoint(terms))


class ArchiveStoreTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        options = patch.dict(os.environ, {"RESURFACE_ARCHIVE_DB": directory.name + "/archive.db",
                                         "DATABASE_URL": "", "VERCEL": ""})
        options.start()
        self.addCleanup(options.stop)
        self.store = ArchiveStore()
        self.store.setup()
        self.account = {"platform": "YouTube", "url": "https://www.youtube.com/@example"}

    def test_profile_is_saved_with_two_independent_caps(self):
        lease = self.store.claim(self.account, False)
        self.assertIsNotNone(lease)
        self.assertIsNone(self.store.claim(self.account, True))
        self.store.inventory(self.account, [
            {"id": f"{kind}{i}", "title": str(i), "format": kind, "publishedAt": f"{i:03d}"}
            for i in range(102) for kind in ("video", "short")])
        saved = {**self.store.video(self.account, "video99"), "status": "ok"}
        self.store.record(self.account, saved, [{"start": 18.08, "text": "an interesting match"}])
        self.store.finish(self.account, lease, True, "")
        reopened = ArchiveStore().snapshot(self.account)
        self.assertEqual(sum(v["format"] == "short" for v in reopened["videos"]), 100)
        self.assertEqual(sum(v["format"] == "video" for v in reopened["videos"]), 100)
        self.assertIsNone(self.store.claim(self.account, False))
        self.assertEqual(self.store.find(self.account, "interesting match")[0]["start"], 18.08)
        self.store.inventory(self.account, [{"id": "new", "title": "New", "format": "video", "publishedAt": "103"}], partial=True)
        self.assertEqual(self.store.transcript(self.account, "video99")["status"], "ok")
        self.assertIsNotNone(self.store.video(self.account, "short99"))

    def test_caption_lease_prevents_duplicate_provider_calls(self):
        self.assertTrue(self.store.claim_caption(self.account, "video1"))
        self.assertFalse(self.store.claim_caption(self.account, "video1"))
        self.store.release_caption(self.account, "video1")
        self.assertTrue(self.store.claim_caption(self.account, "video1"))

    def test_cover_backfill_keeps_existing_captions_and_ignores_unknown_videos(self):
        profile = {"platform": "TikTok", "url": "https://www.tiktok.com/@example"}
        lease = self.store.claim(profile, False)
        self.store.inventory(profile, [{"id": "1", "title": "A clip"}])
        cues = [{"start": 39, "text": "Creator economy."}]
        self.store.record(profile, {"id": "1", "status": "ok"}, cues)
        self.store.finish(profile, lease, True, "")
        jpeg = b"\xff\xd8\xff\xe0data"
        self.assertEqual(self.store.save_covers(profile, [("1", jpeg), ("2", jpeg)]), 1)
        self.assertEqual(self.store.save_covers(profile, [("1", jpeg)]), 0)
        self.assertEqual(self.store.transcript(profile, "1"), {"status": "ok", "segments": cues})
        self.assertIn("thumb=1", self.store.snapshot(profile)["videos"][0]["thumbnail"])
        self.assertEqual(self.store.thumbnail(profile, "1"), (jpeg, "image/jpeg"))
        self.assertIsNone(self.store.thumbnail(profile, "2"))

    def test_archive_search_preserves_first_cue_across_multiple_cues(self):
        self.store.inventory(self.account, [{"id": "video1", "title": "A video", "format": "video"}])
        self.store.record(self.account, {"id": "video1", "status": "ok"}, [
            {"start": 1, "text": "An intro."},
            {"start": 3.5, "text": "Forward movement"},
            {"start": 5, "text": "is still good"},
            {"start": 7, "text": "movement."},
            {"start": 28, "text": "A new subject"},
        ])
        result = self.store.find(self.account, "forward movement is still good movement")
        self.assertEqual([(row["start"], row["text"]) for row in result],
                         [(3.5, "Forward movement is still good movement.")])
        self.assertEqual(self.store.find(self.account, "movement a new subject"), [])


class CoverTests(unittest.TestCase):
    def test_only_browser_image_formats_are_cached(self):
        from server.archive_store import browser_image_type
        self.assertEqual(browser_image_type(b"\xff\xd8\xff\xe0data"), "image/jpeg")
        self.assertEqual(browser_image_type(b"\x89PNG\r\n\x1a\nrest"), "image/png")
        self.assertEqual(browser_image_type(b"RIFF1234WEBPdata"), "image/webp")
        self.assertIsNone(browser_image_type(b"\x00\x00\x00\x18ftypheic"))
        self.assertIsNone(browser_image_type(b""))

    def test_tiktok_cover_prefers_the_jpeg_variant(self):
        from server.treg_archive import tiktok_row
        row = {"aweme_id": "7707847360235228430", "desc": "x", "create_time": 1, "video": {"duration": 9000, "cover": {"url_list": [
            "https://p16-common-sign.tiktokcdn-eu.com/a~x.heic?dr=1", "https://p19-common-sign.tiktokcdn-eu.com/a~x.jpeg?dr=1"]}}}
        self.assertTrue(tiktok_row(row, "kameronmonet")["thumbnail"].endswith(".jpeg?dr=1"))
