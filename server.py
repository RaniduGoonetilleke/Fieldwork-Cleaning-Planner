"""Serve the local planning demonstration without external dependencies."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
import sys
from urllib.parse import parse_qs, unquote, urlsplit

sys.dont_write_bytecode = True
from planner_service import bootstrap, decide, plan_job, evidence, InputError
from customer_service import customer_bootstrap, plan_customer, PENDING_RECORD_CORRECTIONS
from replay_plan import build_export, verify_export, MAX_EXPORT_BYTES

PUBLIC = Path(__file__).resolve().parent / 'public'
MAX_REQUEST = 65536
MAX_CUSTOMER_REQUEST = 384 * 1024
MAX_RESPONSE = 2 * 1024 * 1024


def _reject_duplicate(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise InputError('Duplicate JSON field: ' + key)
        out[key] = value
    return out


def _reject_number(value):
    raise InputError('JSON must not contain ' + value)


def parse_body(raw, maximum_depth=16):
    try:
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=_reject_duplicate, parse_constant=_reject_number)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        raise InputError('Invalid JSON request.') from exc
    stack = [(value, 0)]
    while stack:
        item, depth = stack.pop()
        if depth > maximum_depth:
            raise InputError('The JSON request is nested too deeply.')
        if isinstance(item, dict):
            stack.extend((v, depth + 1) for v in item.values())
        elif isinstance(item, list):
            stack.extend((v, depth + 1) for v in item)
    return value


class Handler(BaseHTTPRequestHandler):
    server_version = 'PlanningDemonstration/1.0'

    def _headers(self, code, content_type, size, extra_headers=None):
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(size))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()

    def _json(self, value, status=200):
        data = json.dumps(value, allow_nan=False, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        if len(data) > MAX_RESPONSE:
            data = b'{"error":"Response exceeded the application limit."}'
            status = 500
        self._headers(status, 'application/json; charset=utf-8', len(data))
        if self.command != 'HEAD':
            self.wfile.write(data)

    def do_GET(self):
        parts = urlsplit(self.path)
        route = unquote(parts.path)
        try:
            if route == '/api/bootstrap':
                self._json(bootstrap())
            elif route == '/api/evidence':
                query = parse_qs(parts.query, keep_blank_values=True)
                if set(query) != {'id'} or len(query['id']) != 1:
                    raise InputError('Supply one known profile ID.')
                response = evidence(query['id'][0])
                served = {item['file'] for item in response['additionalRecords']}
                # The records are served unchanged. Known wording corrections travel beside them.
                response['pendingCorrections'] = [dict(note) for note in PENDING_RECORD_CORRECTIONS if note['file'] in served]
                self._json(response)
            elif route == '/api/customer':
                if parts.query:
                    raise InputError('Customer templates do not accept query parameters.')
                self._json(customer_bootstrap())
            elif route == '/api/health':
                self._json({'ok': True, 'mode': 'offline', 'dispatch': False})
            elif route.startswith('/api/'):
                self._json({'error': 'Unknown API endpoint.'}, 404)
            else:
                self._static(route)
        except InputError as exc:
            self._json({'error': str(exc)}, 400)
        except Exception:
            self._json({'error': 'The demonstration could not compute this response.'}, 500)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        parts = urlsplit(self.path)
        if parts.path not in ('/api/decision', '/api/job', '/api/customer', '/api/replay') or parts.query:
            self._json({'error': 'Unknown API endpoint.'}, 404)
            return
        if self.headers.get('Transfer-Encoding'):
            self._json({'error': 'Transfer encoding is not supported.'}, 400)
            return
        lengths = self.headers.get_all('Content-Length', [])
        try:
            if len(lengths) != 1:
                raise InputError('One Content-Length header is required.')
            length = int(lengths[0])
            limit = (2 * MAX_EXPORT_BYTES + 1024 if parts.path == '/api/replay' else
                     MAX_CUSTOMER_REQUEST if parts.path == '/api/customer' else MAX_REQUEST)
            if not 0 < length <= limit:
                self._json({'error': 'The request must contain 1–%s bytes.' % limit}, 413)
                return
            if self.headers.get_content_type() != 'application/json':
                self._json({'error': 'Use application/json.'}, 415)
                return
            body = self.rfile.read(length)
            if len(body) != length:
                raise InputError('Incomplete request body.')
            payload = parse_body(body, maximum_depth=24 if parts.path == '/api/replay' else 16)
            if parts.path == '/api/decision':
                response = decide(payload)
            elif parts.path == '/api/replay':
                if type(payload) is not dict or set(payload) not in ({'export'}, {'exportText'}):
                    raise InputError('Replay needs exactly one export object or exact exportText string.')
                if 'exportText' in payload:
                    value = payload['exportText']
                    if type(value) is not str or len(value.encode('utf-8')) > MAX_EXPORT_BYTES:
                        raise InputError('Exact plan text is missing or exceeds the replay size limit.')
                    envelope = parse_body(value.encode('utf-8'), maximum_depth=24)
                else:
                    envelope = payload['export']
                response = verify_export(envelope)
            else:
                operation = 'job' if parts.path == '/api/job' else 'customer'
                response = plan_job(payload) if operation == 'job' else plan_customer(payload)
                response['export'] = build_export(operation, payload, response)
                # Keep the exact numeric spelling across a browser JSON round trip.
                response['exportText'] = json.dumps(response['export'], ensure_ascii=False, allow_nan=False, indent=2) + '\n'
            self._json(response)
        except (InputError, ValueError) as exc:
            self._json({'error': str(exc)}, 400)
        except Exception:
            self._json({'error': 'The demonstration could not compute this response.'}, 500)

    def _static(self, route):
        if '\\' in route or '\x00' in route or any(part == '..' for part in route.split('/')):
            self._json({'error': 'Invalid asset path.'}, 400)
            return
        relative = 'index.html' if route == '/' else route.lstrip('/')
        base = PUBLIC.resolve()
        target = (PUBLIC / relative).resolve()
        if not target.is_relative_to(base) or not target.is_file():
            self._json({'error': 'File not found.'}, 404)
            return
        size = target.stat().st_size
        content_type = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
        if content_type.startswith('text/') or content_type in ('application/javascript', 'image/svg+xml'):
            content_type += '; charset=utf-8'
        status, start, end = 200, 0, size - 1
        headers = {'Accept-Ranges': 'bytes'}
        ranges = self.headers.get_all('Range', [])
        # No validator is advertised, so an If-Range request gets the full file.
        if ranges and not self.headers.get('If-Range'):
            try:
                if len(ranges) != 1 or len(ranges[0]) > 256 or not size:
                    raise ValueError('Invalid range')
                match = re.fullmatch(r'bytes=([0-9]*)-([0-9]*)', ranges[0].strip())
                if match is None or not any(match.groups()):
                    raise ValueError('Invalid range')
                first, last = match.groups()
                if first:
                    start = int(first)
                    end = min(int(last), size - 1) if last else size - 1
                    if start >= size or end < start:
                        raise ValueError('Range is outside this file')
                else:
                    suffix = int(last)
                    if suffix == 0:
                        raise ValueError('Empty suffix range')
                    start, end = max(0, size - suffix), size - 1
                status = 206
                headers['Content-Range'] = f'bytes {start}-{end}/{size}'
            except ValueError:
                headers['Content-Range'] = f'bytes */{size}'
                self._headers(416, content_type, 0, headers)
                return
        remaining = max(0, end - start + 1)
        self._headers(status, content_type, remaining, headers)
        if self.command == 'HEAD':
            return
        with target.open('rb') as stream:
            stream.seek(start)
            while remaining:
                chunk = stream.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def log_message(self, format, *args):
        # Request bodies and declaration data are not logged.
        sys.stderr.write('%s %s\n' % (self.log_date_time_string(), format % args))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print('Local planning demonstration: http://%s:%s' % (args.host, args.port), flush=True)
    print('Authored facts only. No robot connection or dispatch.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
