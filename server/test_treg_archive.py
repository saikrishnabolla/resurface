import unittest
from unittest.mock import patch

from server import treg_archive as archive


def youtube_video(id_, date_, **row):
    return {"id": id_, "publishDate": date_, "title": id_, **row}


class TregArchiveTests(unittest.TestCase):
    def test_profile_url_normalization_and_rejection(self):
        self.assertEqual(
            archive.normalize_profile("youtube.com/@KameronMonet/videos?x=1"),
            {"platform": "YouTube", "handle": "@KameronMonet", "url": "https://www.youtube.com/@KameronMonet"},
        )
        self.assertEqual(archive.normalize_profile("https://tiktok.com/@KameronMonet/")["handle"], "@kameronmonet")
        self.assertEqual(archive.normalize_profile("instagram.com/KameronMonet/reels/")["platform"], "Instagram")
        for invalid in ("https://www.youtube.com.evil.test/@creator", "https://evil.test@instagram.com/example",
                        "https://www.instagram.com/reel/XxXxX/", "https://www.tiktok.com/@author/video/123",
                        "https://youtube.com:8443/@creator", "ftp://youtube.com/@creator", "youtube.com/watch?v=ABCDEFGHIJK"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                archive.normalize_profile(invalid)

    def test_youtube_merges_pages_and_short_duplicates_then_skips_saved_captions(self):
        long, short, old = "AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC"

        def provider(token, tool, **query):
            self.assertEqual(token, "fake")
            if tool == archive.YT_VIDEOS:
                self.assertEqual(query["handle"], "KameronMonet")
                if query.get("continuationToken") == "second":
                    return {"videos": [youtube_video(old, "2026-10-01")]}
                return {"videos": [youtube_video(long, "2026-11-02", description="Source copy", lengthText="8:59"),
                                    youtube_video(short, "2026-11-03")], "continuationToken": "second"}
            if tool == archive.YT_SHORTS:
                return {"shorts": [youtube_video(short, "2026-11-03", description="Short description")]}
            self.assertEqual(tool, archive.YT_TRANSCRIPT)
            self.assertTrue(query["url"].endswith(long))
            return {"videoId": long, "transcript": [{"startMs": "168239", "text": "Useful quote"},
                                                     {"startMs": "NaN", "text": "invalid"}]}

        with patch.object(archive, "call", provider):
            events = list(archive.import_events("fake", "youtube.com/@KameronMonet",
                                               {short: {"status": "ok"}, old: "no_captions"}))
        self.assertEqual([event["kind"] for event in events], ["listed", "videos", "item", "done"])
        self.assertEqual([row["id"] for row in events[1]["videos"]], [short, long, old])
        self.assertEqual(events[1]["videos"][0]["format"], "short")
        self.assertTrue(events[1]["videos"][0]["url"].endswith("/shorts/" + short))
        self.assertEqual(events[1]["videos"][1]["description"], "Source copy")
        self.assertEqual(events[1]["videos"][1]["duration"], 539)
        self.assertEqual(events[2]["segments"], [{"start": 168.239, "text": "Useful quote"}])

    def test_tiktok_uses_native_timing_and_ignores_image_posts(self):
        id_ = "7499229683859426602"

        def provider(_, tool, **query):
            if tool == archive.TT_VIDEOS:
                if "max_cursor" not in query:
                    return {"aweme_list": [{"aweme_id": id_, "image_post_info": {"images": []}, "video": {"duration": 2000}}],
                            "has_more": 1, "max_cursor": 123}
                self.assertEqual(query["max_cursor"], 123)
                return {"aweme_list": [{"aweme_id": id_, "create_time": 1739470683, "desc": "Example",
                                        "video": {"duration": 26250, "cover": {"url_list": ["https://p16.tiktokcdn-us.com/img/test"]}}}],
                        "has_more": 0}
            self.assertEqual(tool, archive.TT_TRANSCRIPT)
            self.assertEqual(query["use_ai_as_fallback"], "false")
            self.assertTrue(query["url"].endswith("/@author/video/" + id_))
            return {"id": id_, "transcript": "WEBVTT\n\n1\n00:00:01.125 --> 00:00:01.998\n<c>Real &amp; timed</c>\n\n"}

        with patch.object(archive, "call", provider):
            events = list(archive.import_events("fake", "tiktok.com/@author"))
        self.assertEqual(events[0]["total"], 1)
        self.assertEqual(events[1]["videos"][0]["duration"], 26.25)
        self.assertEqual(events[2]["segments"], [{"start": 1.125, "text": "Real & timed"}])
        self.assertEqual(archive.webvtt_segments("Untimed prose should not get a timestamp."), [])

    def test_instagram_lists_only_reels_and_does_not_call_paid_transcription(self):
        tools = set()

        def provider(_, tool, **query):
            tools.add(tool)
            self.assertEqual(query["handle"], "creator")
            self.assertEqual(tool, archive.IG_REELS)
            return {"items": [{"media": {"code": "ShortCode1", "taken_at": 1755000000,
                                          "caption": {"text": "Share of the reel"}}},
                              {"media": {"code": "PhotoOnly1", "media_type": 1}},
                              {"media": {"code": "VideoOnly1", "media_type": 2, "product_type": "feed"}}],
                    "paging_info": {"more_available": False}}

        with patch.object(archive, "call", provider):
            events = list(archive.import_events("fake", "instagram.com/creator"))
        self.assertEqual(tools, {archive.IG_REELS})
        self.assertEqual([row["id"] for row in events[1]["videos"]], ["ShortCode1"])
        self.assertEqual(events[1]["videos"][0]["description"], "Share of the reel")
        self.assertTrue(events[1]["videos"][0]["url"].endswith("/reel/ShortCode1/"))
        self.assertEqual([event["kind"] for event in events], ["listed", "videos", "done"])

    def test_instagram_transcript_uses_only_timed_segments_of_the_selected_video(self):
        profile = archive.normalize_profile("instagram.com/creator")
        video = {"id": "ShortCode1", "duration": 97, "format": "short", "url": "https://untrusted.test/"}
        result = {"transcripts": [
            {"shortcode": "OtherCode1", "transcript_with_timestamp": [{"start": 0, "text": "Wrong video"}]},
            {"shortcode": "ShortCode1", "text": "Untimed prose",
             "transcript_with_timestamp": [{"start": 1.234, "end": 5, "text": "Timed phrase"},
                                           {"start": -1, "text": "Invalid time"}]},
        ]}
        with patch.object(archive, "call", return_value=result) as upstream:
            self.assertEqual(archive.fetch_transcript("fake", profile, video), [{"start": 1.234, "text": "Timed phrase"}])
            upstream.assert_called_once_with("fake", archive.IG_TRANSCRIPT, url="https://www.instagram.com/reel/ShortCode1/")
            self.assertEqual(archive.fetch_transcript("fake", profile, {**video, "duration": 120.1}), [])
            self.assertEqual(upstream.call_count, 1)

    def test_caps_at_100_and_keeps_listing_when_one_feed_fails(self):
        def provider(_, tool, **query):
            if tool == archive.YT_SHORTS:
                raise archive.ProviderError(502)
            self.assertEqual(tool, archive.YT_VIDEOS)
            page = int(query.get("continuationToken", 0))
            return {"videos": [youtube_video(f"AAA{i:08d}", "2026-11-02") for i in range(page * 30, (page + 1) * 30)],
                    "continuationToken": str(page + 1)}

        with patch.object(archive, "call", provider):
            events = list(archive.import_events("fake", "youtube.com/@creator", max_caption_calls=0))
        self.assertEqual(events[0]["total"], 100)
        self.assertEqual(len(events[1]["videos"]), 100)
        self.assertIs(events[1]["partial"], True)
        self.assertTrue(events[-1]["failed"])

    def test_youtube_uses_independent_feed_caps_and_refills_duplicate_slot(self):
        def provider(_, tool, **query):
            if tool == archive.YT_TRANSCRIPT:
                return {"videoId": query["url"].rsplit("=", 1)[1], "transcript": []}
            self.assertIn(tool, {archive.YT_SHORTS, archive.YT_VIDEOS})
            is_short = tool == archive.YT_SHORTS
            field = "shorts" if is_short else "videos"
            if query.get("continuationToken") == "refill":
                self.assertFalse(is_short)
                return {field: [youtube_video("AAA00000100", "2026-08-01")]}
            rows = [youtube_video(f"{'BBB' if is_short else 'AAA'}{i:08d}",
                                  "2026-11-02" if is_short else "2026-11-01") for i in range(100)]
            if not is_short:
                rows[0] = youtube_video("BBB00000000", "2026-11-02", description="More metadata")
            return {field: rows, **({} if is_short else {"continuationToken": "refill"})}

        with patch.object(archive, "call", provider):
            events = list(archive.import_events("fake", "youtube.com/@creator"))
        videos = events[1]["videos"]
        self.assertEqual(events[0]["total"], 200)
        self.assertEqual(sum(row["format"] == "video" for row in videos), 100)
        self.assertEqual(sum(row["format"] == "short" for row in videos), 100)
        self.assertEqual(len({row["id"] for row in videos}), 200)
        self.assertEqual(videos[0]["description"], "More metadata")
        self.assertEqual(videos[-1]["id"], "AAA00000100")
        self.assertIs(events[1]["partial"], False)
        self.assertEqual(sum(event["kind"] == "item" for event in events), 200)


if __name__ == "__main__":
    unittest.main()
