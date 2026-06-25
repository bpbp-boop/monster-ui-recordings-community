#!/usr/bin/env python3.6
"""KAZOO call-recording email receiver.

Listens for the webhook POSTed by KAZOO when a `call_recording` document is
created, downloads the recording media from KAZOO, and emails it as an
attachment to a fixed address.

Standard library only (Python 3.6+): http.server, urllib, smtplib, email.
"""

import argparse
import configparser
import datetime
import json
import logging
import os
import smtplib
import socketserver
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, HTTPServer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("recordings-email")

# populated from the config file in main()
CONFIG = {}


def kazoo_auth_token():
    """Exchange the configured API key for a short-lived auth token."""
    url = CONFIG["kazoo_api_base"].rstrip("/") + "/api_auth"
    body = json.dumps({"data": {"api_key": CONFIG["kazoo_api_key"]}}).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="PUT",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return payload["auth_token"]


def download_recording(account_id, recording_id, auth_token):
    """Fetch the recording media from KAZOO.

    Returns (bytes, content_type). KAZOO does exact Accept matching: only
    "Accept: audio/mpeg" yields the binary media (any other value returns the
    JSON doc or an empty body). It then serves the bytes in whatever format the
    recording was stored as, so we read the real Content-Type off the response.

    With S3/external storage the audio is uploaded to the backend just after the
    doc is saved (which is when the webhook fires), so the media briefly 404s
    until that upload lands. Retry a bounded number of times on 404 to ride out
    that window; any other status fails immediately.
    """
    url = "{base}/accounts/{account}/recordings/{rec}".format(
        base=CONFIG["kazoo_api_base"].rstrip("/"),
        account=account_id,
        rec=recording_id,
    )
    req = urllib.request.Request(
        url, method="GET",
        headers={"X-Auth-Token": auth_token, "Accept": "audio/mpeg"},
    )
    attempts = max(1, CONFIG["download_retries"])
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                content_type = resp.headers.get("Content-Type", "audio/mpeg")
                return resp.read(), content_type
        except urllib.error.HTTPError as exc:
            if exc.code != 404 or attempt == attempts:
                raise
            log.info("media for %s not available yet (404), retry %d/%d in %ss",
                     recording_id, attempt, attempts - 1,
                     CONFIG["download_retry_delay"])
            time.sleep(CONFIG["download_retry_delay"])


def fetch_recording_doc(account_id, recording_id, auth_token):
    """Fetch the recording's metadata document (the JSON the same endpoint
    returns for any non-audio Accept). Returns the `data` dict, or {} on
    failure so a metadata hiccup never blocks delivering the recording."""
    url = "{base}/accounts/{account}/recordings/{rec}".format(
        base=CONFIG["kazoo_api_base"].rstrip("/"),
        account=account_id,
        rec=recording_id,
    )
    req = urllib.request.Request(
        url, method="GET",
        headers={"X-Auth-Token": auth_token, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8")).get("data", {})
    except Exception as exc:  # noqa: BLE001 - metadata is best-effort
        log.warning("could not fetch recording metadata for %s: %s",
                    recording_id, exc)
        return {}


# Kazoo timestamps are gregorian seconds (since year 0); offset to unix epoch
GREGORIAN_OFFSET = 62167219200

# account timezone is stable, so cache it per account for the process lifetime
_ACCOUNT_TZ = {}
# os.environ['TZ']/tzset() is process-global, so serialise the format call
_TZ_LOCK = threading.Lock()


def get_account_timezone(account_id, auth_token):
    """Return the account doc's `timezone` (IANA name) or None. Cached."""
    if account_id in _ACCOUNT_TZ:
        return _ACCOUNT_TZ[account_id]
    url = "{base}/accounts/{account}".format(
        base=CONFIG["kazoo_api_base"].rstrip("/"), account=account_id,
    )
    req = urllib.request.Request(
        url, method="GET",
        headers={"X-Auth-Token": auth_token, "Accept": "application/json"},
    )
    tz = None
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            tz = json.loads(resp.read().decode("utf-8")).get("data", {}).get("timezone")
    except Exception as exc:  # noqa: BLE001 - timezone is best-effort
        log.warning("could not fetch account timezone for %s: %s", account_id, exc)
    _ACCOUNT_TZ[account_id] = tz
    return tz


def format_timestamp(gregorian_seconds, tz):
    """Format a Kazoo gregorian timestamp in the given IANA timezone, resolved
    via the system tz database (TZ + time.tzset, stdlib-only on Unix). Falls
    back to UTC if no/invalid zone or tzset is unavailable."""
    unix = gregorian_seconds - GREGORIAN_OFFSET
    if tz and hasattr(time, "tzset"):
        with _TZ_LOCK:
            previous = os.environ.get("TZ")
            os.environ["TZ"] = tz
            time.tzset()
            try:
                return time.strftime("%Y-%m-%d %H:%M:%S %Z", time.localtime(unix))
            finally:
                if previous is None:
                    os.environ.pop("TZ", None)
                else:
                    os.environ["TZ"] = previous
                time.tzset()
    return datetime.datetime.utcfromtimestamp(unix).strftime("%Y-%m-%d %H:%M:%S UTC")


def _format_party(name, number):
    name = (name or "").strip()
    number = (number or "").strip()
    if name and number and name != number:
        return "{name} <{number}>".format(name=name, number=number)
    return name or number


def format_call_details(doc, tz):
    """Build (subject_suffix, body_text) from a recording metadata doc, with
    the timestamp rendered in the account timezone `tz`. Empty/unknown fields
    are omitted."""
    direction = (doc.get("direction") or doc.get("call_direction") or "").capitalize()
    caller = _format_party(doc.get("caller_id_name"), doc.get("caller_id_number")) \
        or (doc.get("from") or "")
    callee = _format_party(doc.get("callee_id_name"), doc.get("callee_id_number")) \
        or (doc.get("to") or "")

    when = ""
    start = doc.get("start_time")
    if isinstance(start, (int, float)) and start > GREGORIAN_OFFSET:
        when = format_timestamp(start, tz)

    seconds = doc.get("duration")
    if not isinstance(seconds, (int, float)) \
            and isinstance(doc.get("duration_ms"), (int, float)):
        seconds = doc["duration_ms"] / 1000.0
    duration = ""
    if isinstance(seconds, (int, float)):
        seconds = int(seconds)
        duration = "{m}:{s:02d}".format(m=seconds // 60, s=seconds % 60)

    rows = [
        ("Direction", direction),
        ("From", caller),
        ("To", callee),
        ("Date / time", when),
        ("Duration", duration),
        ("Call ID", doc.get("call_id") or ""),
    ]
    body = "\n".join(
        "{label}: {value}".format(label=label, value=value)
        for label, value in rows if value
    )

    if caller or callee:
        subject_suffix = "{caller} -> {callee}".format(
            caller=caller or "?", callee=callee or "?")
    else:
        subject_suffix = ""
    return subject_suffix, body


# maps recording content types to a file extension for the attachment
AUDIO_EXTENSIONS = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
}


def send_email(to_addr, recording_id, audio_bytes, content_type, doc, tz):
    """Email the recording media as an attachment, with call details from the
    recording metadata doc in the body and subject."""
    # content_type may carry params, e.g. "audio/wav; charset=binary"
    mime = content_type.split(";")[0].strip().lower()
    maintype, _, subtype = mime.partition("/")
    if maintype != "audio" or not subtype:
        maintype, subtype = "application", "octet-stream"
    ext = AUDIO_EXTENSIONS.get(mime, subtype or "bin")

    subject_suffix, details = format_call_details(doc, tz)

    msg = EmailMessage()
    msg["From"] = CONFIG["email_from"]
    msg["To"] = to_addr
    msg["Subject"] = "{prefix}: {suffix}".format(
        prefix=CONFIG["email_subject_prefix"],
        suffix=subject_suffix or recording_id,
    )
    body = "A new call recording is attached.\n"
    if details:
        body += "\n" + details + "\n"
    body += "\nRecording ID: {rec}\n".format(rec=recording_id)
    msg.set_content(body)
    msg.add_attachment(
        audio_bytes,
        maintype=maintype,
        subtype=subtype,
        filename="{rec}.{ext}".format(rec=recording_id, ext=ext),
    )

    host = CONFIG["smtp_host"]
    port = CONFIG["smtp_port"]
    if CONFIG["smtp_use_tls"] and port == 465:
        server = smtplib.SMTP_SSL(host, port, timeout=30,
                                  context=ssl.create_default_context())
    else:
        server = smtplib.SMTP(host, port, timeout=30)
        if CONFIG["smtp_use_tls"]:
            server.starttls(context=ssl.create_default_context())
    try:
        if CONFIG["smtp_username"]:
            server.login(CONFIG["smtp_username"], CONFIG["smtp_password"])
        server.send_message(msg)
    finally:
        server.quit()


def handle_event(payload):
    """Validate and process a single webhook event payload.

    KAZOO merges the webhook's custom_data into the top level of the event
    body, so `token`/`email` arrive as top-level keys. We still fall back to a
    nested custom_data object for robustness against other senders/formats.
    """
    custom = payload.get("custom_data") or {}

    def field(name):
        return payload[name] if name in payload else custom.get(name)

    if field("token") != CONFIG["token"]:
        raise PermissionError("token mismatch")

    account_id = payload.get("account_id") or payload.get("account", {}).get("id")
    recording_id = payload.get("id") or payload.get("recording_id")
    to_addr = field("email") or CONFIG["email_to"]

    if not (account_id and recording_id and to_addr):
        raise ValueError(
            "missing account_id/recording_id/email in payload"
        )

    log.info("processing recording %s for account %s -> %s",
             recording_id, account_id, to_addr)
    auth_token = kazoo_auth_token()
    tz = get_account_timezone(account_id, auth_token)
    doc = fetch_recording_doc(account_id, recording_id, auth_token)
    audio, content_type = download_recording(account_id, recording_id, auth_token)
    send_email(to_addr, recording_id, audio, content_type, doc, tz)
    log.info("emailed recording %s (%d bytes, %s) to %s",
             recording_id, len(audio), content_type, to_addr)


class Handler(BaseHTTPRequestHandler):
    def _reply(self, code, message):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(message.encode("utf-8"))

    def do_POST(self):
        if self.path.split("?")[0] != CONFIG["path"]:
            self._reply(404, "not found")
            return

        # optional source-IP allowlist (the token alone is not a real secret,
        # since it ships in the client-served app.js)
        peer = self.client_address[0]
        if CONFIG["allowed_ips"] and peer not in CONFIG["allowed_ips"]:
            log.warning("rejected request from disallowed peer %s", peer)
            self._reply(403, "forbidden")
            return

        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""

        try:
            payload = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._reply(400, "invalid json")
            return

        try:
            handle_event(payload)
        except PermissionError:
            log.warning("rejected request: token mismatch")
            self._reply(403, "forbidden")
            return
        except Exception as exc:  # noqa: BLE001 - log and report failure
            log.exception("failed to process event: %s", exc)
            self._reply(500, "error")
            return

        self._reply(200, "ok")

    def log_message(self, fmt, *args):  # route access logs through logging
        log.info("%s - %s", self.address_string(), fmt % args)


class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    """ThreadingHTTPServer is only stdlib from 3.7; build it for 3.6."""
    daemon_threads = True


def load_config(path):
    parser = configparser.ConfigParser()
    if not parser.read(path):
        raise SystemExit("could not read config file: {}".format(path))

    CONFIG.update({
        "listen_host": parser.get("server", "listen_host", fallback="0.0.0.0"),
        "listen_port": parser.getint("server", "listen_port", fallback=8080),
        "path": parser.get("server", "path", fallback="/recordings-email"),
        "kazoo_api_base": parser.get("kazoo", "api_base"),
        "kazoo_api_key": parser.get("kazoo", "api_key"),
        # with S3/external storage the audio is uploaded just after the doc is
        # saved (and the webhook fires), so the media can 404 for a few seconds
        "download_retries": parser.getint(
            "kazoo", "download_retries", fallback=6),
        "download_retry_delay": parser.getfloat(
            "kazoo", "download_retry_delay", fallback=5.0),
        "email_to": parser.get("email", "to", fallback=""),
        "email_from": parser.get("email", "from"),
        "email_subject_prefix": parser.get(
            "email", "subject_prefix", fallback="New call recording"),
        "smtp_host": parser.get("smtp", "host"),
        "smtp_port": parser.getint("smtp", "port", fallback=25),
        "smtp_username": parser.get("smtp", "username", fallback=""),
        "smtp_password": parser.get("smtp", "password", fallback=""),
        "smtp_use_tls": parser.getboolean("smtp", "use_tls", fallback=False),
        "token": parser.get("security", "token"),
        "allowed_ips": [
            ip.strip()
            for ip in parser.get("security", "allowed_ips", fallback="").split(",")
            if ip.strip()
        ],
    })


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default="/etc/recordings-email/config.ini")
    args = ap.parse_args()

    load_config(args.config)

    server = ThreadingHTTPServer(
        (CONFIG["listen_host"], CONFIG["listen_port"]), Handler)
    log.info("listening on %s:%s%s",
             CONFIG["listen_host"], CONFIG["listen_port"], CONFIG["path"])
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down")
        server.shutdown()


if __name__ == "__main__":
    sys.exit(main())
