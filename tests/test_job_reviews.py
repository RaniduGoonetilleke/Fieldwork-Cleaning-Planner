"""The "Job reviews" step is a local note. These tests check that it has no way into planning."""
from copy import deepcopy
import http.client
import json
from pathlib import Path
import sys
import threading
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import customer_service as service  # noqa: E402
from planner_service import InputError  # noqa: E402
from replay_plan import build_export  # noqa: E402

DAY = {'admissionDateUtc': '2026-11-12'}
REVIEW = {'job': 'Wipe a whiteboard', 'place': 'Meeting room / Whiteboard 1', 'happened': 'COMPLETED', 'doneBy': 'ROBOT',
          'acceptance': 'ACCEPTED', 'checkedBy': 'Building supervisor', 'checkedOn': '2026-11-12'}


def base():
    return deepcopy(service.customer_examples(DAY)[0]['inputs'])


class JobReviewsStayOutOfPlanningTests(unittest.TestCase):
    def test_the_planning_service_refuses_a_request_that_carries_job_reviews(self):
        for key in ('jobReviews', 'reviews', 'outcomes'):
            payload = base(); payload[key] = [deepcopy(REVIEW)]
            with self.assertRaises(InputError):
                service.plan_customer(payload, evaluation=DAY)
        for field in ('jobReview', 'acceptance', 'outcome'):
            payload = base(); payload['tasks'][0][field] = deepcopy(REVIEW)
            with self.assertRaises(InputError):
                service.plan_customer(payload, evaluation=DAY)

    def test_a_plan_and_its_download_hold_no_job_review_field(self):
        inputs = base(); result = service.plan_customer(inputs, evaluation=DAY)
        text = json.dumps(build_export('customer', inputs, result)).replace(service.RELEASE, '')   # the release label itself contains the words
        for word in ('jobReview', 'job-review', 'doneBy', 'checkedBy', 'checkedOn', 'acceptance', 'checkClearedAt', 'plannedText', 'inventedExample'):
            self.assertNotIn(word, text)

    def test_the_service_code_never_reads_job_reviews(self):
        for name in ('customer_service.py', 'planner_service.py', 'replay_plan.py', 'server.py', *('api/' + path.name for path in sorted((ROOT / 'api').glob('*.py')))):
            source = (ROOT / name).read_text().replace(service.RELEASE, '').lower()   # the release label itself contains the words
            for word in ('jobreview', 'job-review', 'job_review', 'job review'):
                self.assertNotIn(word, source, name)

    def test_no_server_route_accepts_a_job_review(self):
        from server import Handler, ThreadingHTTPServer

        class Quiet(Handler):
            def log_message(self, *args):
                pass
        httpd = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        try:
            for path in ('/api/job-reviews', '/api/reviews', '/api/outcomes', '/api/registry'):
                conn = http.client.HTTPConnection('127.0.0.1', httpd.server_port, timeout=5)
                conn.request('POST', path, body=json.dumps(REVIEW), headers={'Content-Type': 'application/json'})
                status = conn.getresponse().status; conn.close()
                self.assertEqual(status, 404, path)
            # The two page modules are served as plain files, like the rest of the page.
            for path in ('/job-review-store.js', '/job-review-ui.js'):
                conn = http.client.HTTPConnection('127.0.0.1', httpd.server_port, timeout=5)
                conn.request('GET', path); res = conn.getresponse(); body = res.read(); conn.close()
                self.assertEqual(res.status, 200, path); self.assertEqual(body, (ROOT / 'public' / path[1:]).read_bytes())
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join()

    def test_the_readme_states_what_a_job_review_is_and_is_not(self):
        readme = (ROOT / 'README.md').read_text()
        for sentence in ('## After the work: job reviews',
                         'A job review never changes a plan or what a robot may be offered.',
                         'The supervisor accepting a result is a different thing from showing that a robot can do the job.',
                         'No job review has been collected from real work.',
                         'Changing what happened removes the recorded check.',
                         'Saving with nothing changed keeps the check.',
                         'Earlier answers and earlier checks are not kept.',
                         'The job and place of a note that is tied to a plan cannot be retyped.',
                         'It does not show that the work happened, and it is not a verified approval.',
                         'The app does not check that the plan can still be worked out again.',
                         'If the note is changed in another tab or window after a form was opened, that form is refused and nothing is saved.',
                         'The refused action is never repeated for you.',
                         'An invented example is left out of the counts, checked or not, and the mark stays if the note is later detached or linked to another job.',
                         'nothing checks that they describe real work.'):
            self.assertIn(sentence, readme)
        self.assertNotIn('success rate of', readme.lower())


if __name__ == '__main__':
    unittest.main(verbosity=2)
