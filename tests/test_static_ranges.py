"""Check local media delivery, byte seeking and the existing asset boundary."""
import http.client
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class QuietHandler(server.Handler):
    def log_message(self, *args):
        pass


class StaticRangeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.public = Path(cls.temp.name) / 'public'
        cls.public.mkdir()
        cls.content = bytes(range(256)) * 1024
        (cls.public / 'tour.mp4').write_bytes(cls.content)
        (cls.public / 'captions.vtt').write_text('WEBVTT\n\n', encoding='utf-8')
        (cls.public / 'empty.mp4').write_bytes(b'')
        (cls.public.parent / 'private.txt').write_text('outside public')
        (cls.public / 'outside.txt').symlink_to(cls.public.parent / 'private.txt')
        cls.public_patch = patch.object(server, 'PUBLIC', cls.public)
        cls.public_patch.start()
        try:
            cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        except Exception:
            cls.public_patch.stop()
            cls.temp.cleanup()
            raise
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()
        cls.public_patch.stop()
        cls.temp.cleanup()

    def request(self, path='/tour.mp4', method='GET', headers=None):
        connection = http.client.HTTPConnection(*self.httpd.server_address, timeout=5)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def assert_range(self, value, start, end):
        status, headers, body = self.request(headers={'Range': value})
        self.assertEqual(status, 206)
        self.assertEqual(body, self.content[start:end + 1])
        self.assertEqual(headers['Content-Length'], str(end - start + 1))
        self.assertEqual(headers['Content-Range'], f'bytes {start}-{end}/{len(self.content)}')
        self.assertEqual(headers['Accept-Ranges'], 'bytes')
        self.assertEqual(headers['Content-Type'], 'video/mp4')

    def test_whole_file(self):
        status, headers, body = self.request()
        self.assertEqual((status, body), (200, self.content))
        self.assertEqual(headers['Content-Length'], str(len(self.content)))
        self.assertEqual(headers['Accept-Ranges'], 'bytes')
        self.assertNotIn('Content-Range', headers)

    def test_bounded_range(self):
        self.assert_range('bytes=512-1023', 512, 1023)

    def test_open_range(self):
        self.assert_range('bytes=262140-', 262140, len(self.content) - 1)

    def test_suffix_range(self):
        self.assert_range('bytes=-17', len(self.content) - 17, len(self.content) - 1)

    def test_end_is_clamped(self):
        self.assert_range('bytes=262140-999999', 262140, len(self.content) - 1)

    def test_large_suffix(self):
        self.assert_range('bytes=-999999', 0, len(self.content) - 1)

    def test_invalid_ranges(self):
        values = ['bytes=', 'bytes=-', 'bytes=-0', 'bytes=20-10', 'bytes=262144-',
                  'bytes=0-1,4-5', 'items=0-1', 'bytes=a-b', 'bytes=+1-2',
                  'bytes=1 -2', 'bytes=' + '9' * 300 + '-']
        for value in values:
            with self.subTest(value=value):
                status, headers, body = self.request(headers={'Range': value})
                self.assertEqual((status, body), (416, b''))
                self.assertEqual(headers['Content-Range'], f'bytes */{len(self.content)}')
                self.assertEqual(headers['Content-Length'], '0')

    def test_head_matches_get_headers(self):
        for headers in ({}, {'Range': 'bytes=2-5'}, {'Range': 'bytes=4-1'}):
            with self.subTest(headers=headers):
                get_status, get_headers, _ = self.request(headers=headers)
                status, head_headers, body = self.request(method='HEAD', headers=headers)
                self.assertEqual(status, get_status)
                self.assertEqual(body, b'')
                for key in ('Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges'):
                    self.assertEqual(head_headers.get(key), get_headers.get(key))

    def test_duplicate_range_headers(self):
        connection = http.client.HTTPConnection(*self.httpd.server_address, timeout=5)
        try:
            connection.putrequest('GET', '/tour.mp4')
            connection.putheader('Range', 'bytes=0-1')
            connection.putheader('Range', 'bytes=4-5')
            connection.endheaders()
            response = connection.getresponse()
            self.assertEqual(response.status, 416)
            self.assertEqual(response.getheader('Content-Range'), f'bytes */{len(self.content)}')
            self.assertEqual(response.read(), b'')
        finally:
            connection.close()

    def test_if_range_without_validator_sends_whole_file(self):
        status, headers, body = self.request(headers={'Range': 'bytes=1-3', 'If-Range': '"old"'})
        self.assertEqual((status, body), (200, self.content))
        self.assertNotIn('Content-Range', headers)

    def test_empty_file(self):
        self.assertEqual(self.request('/empty.mp4')[::2], (200, b''))
        status, headers, body = self.request('/empty.mp4', headers={'Range': 'bytes=0-'})
        self.assertEqual((status, body), (416, b''))
        self.assertEqual(headers['Content-Range'], 'bytes */0')

    def test_caption_mime(self):
        status, headers, body = self.request('/captions.vtt')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Type'], 'text/vtt; charset=utf-8')
        self.assertEqual(body, b'WEBVTT\n\n')

    def test_path_boundaries_with_range(self):
        for path, expected in [('/../private.txt', 400), ('/%2e%2e/private.txt', 400),
                               ('/bad%5cpath', 400), ('/bad%00path', 400),
                               ('/outside.txt', 404), ('/missing.mp4', 404)]:
            with self.subTest(path=path):
                status, headers, body = self.request(path, headers={'Range': 'bytes=0-1'})
                self.assertEqual(status, expected)
                self.assertNotIn(b'outside public', body)

    def test_partial_and_head_do_not_use_read_bytes(self):
        with patch.object(Path, 'read_bytes', side_effect=AssertionError('Whole-file allocation')):
            self.assert_range('bytes=3-5', 3, 5)
            self.assertEqual(self.request(method='HEAD')[0], 200)

    def test_range_does_not_change_health_api(self):
        status, headers, body = self.request('/api/health', headers={'Range': 'bytes=0-2'})
        self.assertEqual(status, 200)
        self.assertNotIn('Content-Range', headers)
        self.assertIn(b'"dispatch":false', body)


if __name__ == '__main__':
    unittest.main()
