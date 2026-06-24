#!/usr/bin/env python3.6
"""KAZOO call-recording email receiver.

Listens for the webhook POSTed by KAZOO when a `call_recording` document is
created, downloads the recording media from KAZOO, and emails it as an
attachment to a fixed address.

Standard library only (Python 3.6+): http.server, urllib, smtplib, email.
"""

import argparse
import configparser
import json
import logging
import smtplib
import socketserver
import ssl
import sys
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
    with urllib.request.urlopen(req, timeout=120) as resp:
        content_type = resp.headers.get("Content-Type", "audio/mpeg")
        return resp.read(), content_type


# maps recording content types to a file extension for the attachment
AUDIO_EXTENSIONS = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
}


def send_email(to_addr, recording_id, audio_bytes, content_type):
    """Email the recording media as an attachment."""
    # content_type may carry params, e.g. "audio/wav; charset=binary"
    mime = content_type.split(";")[0].strip().lower()
    maintype, _, subtype = mime.partition("/")
    if maintype != "audio" or not subtype:
        maintype, subtype = "application", "octet-stream"
    ext = AUDIO_EXTENSIONS.get(mime, subtype or "bin")

    msg = EmailMessage()
    msg["From"] = CONFIG["email_from"]
    msg["To"] = to_addr
    msg["Subject"] = "{prefix} {rec}".format(
        prefix=CONFIG["email_subject_prefix"], rec=recording_id,
    )
    msg.set_content(
        "A new call recording ({rec}) is attached.".format(rec=recording_id)
    )
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
    audio, content_type = download_recording(account_id, recording_id, auth_token)
    send_email(to_addr, recording_id, audio, content_type)
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
