# Call-recording email receiver

A small Python 3.6 (standard library only) HTTP service that receives the KAZOO
webhook fired when a `call_recording` document is created, downloads the
recording media, and emails it as an attachment to a fixed address.

It is the server-side half of the **Account → Settings → Recording emails**
toggle in the recordings-community Monster UI app. Turning that toggle on
creates a KAZOO webhook (`hook: object`, `type: call_recording`,
`action: doc_created`) that POSTs to this receiver; turning it off deletes the
webhook.

## Configure the Monster UI app

In `app.js`, set `appFlags.emailWebhook`:

- `receiverUri` – public URL of this receiver, including the path, e.g.
  `https://hooks.example.com/recordings-email`.
- `token` – shared secret; must equal `[security] token` below.

## Install

```bash
# 1. dedicated service user (no login, no home)
sudo useradd --system --no-create-home --shell /usr/sbin/nologin recordings-email

# 2. program
sudo install -d /opt/recordings-email
sudo install -m 0755 receiver.py /opt/recordings-email/receiver.py

# 3. config (contains API key + SMTP password)
sudo install -d /etc/recordings-email
sudo install -m 0600 -o recordings-email -g recordings-email \
    config.ini.example /etc/recordings-email/config.ini
sudo -e /etc/recordings-email/config.ini    # fill in real values

# 4. systemd unit
sudo install -m 0644 recordings-email.service /etc/systemd/system/recordings-email.service
sudo systemctl daemon-reload
sudo systemctl enable --now recordings-email
```

Put a TLS-terminating reverse proxy (nginx/Apache) in front of the listener so
KAZOO can POST over HTTPS, or run the listener on a host already fronted by one.

## Operate

```bash
systemctl status recordings-email
journalctl -u recordings-email -f
```

## Webhook payload format

KAZOO sends a flat JSON body and **merges the webhook's `custom_data` into the
top level**, so `token`/`email` arrive as top-level keys (verified against
KAZOO 4.3.140):

```json
{
  "id": "202606-c43fb3a04a254e9eb92e87f0e4644e3e",
  "account_id": "a7970214d8a860b03b6598ff72836dcd",
  "action": "doc_created",
  "type": "call_recording",
  "token": "<shared-secret>",
  "email": "archive@example.com",
  "cluster_id": "..."
}
```

The body carries only `id` + `account_id` (not the full recording doc), so the
receiver fetches the media itself with `Accept: audio/mpeg` (the only Accept
value KAZOO honours for the binary; it returns the stored format, e.g.
`audio/wav`).

## Test without KAZOO

```bash
curl -X POST http://127.0.0.1:8080/recordings-email \
  -H 'Content-Type: application/json' \
  -d '{"account_id":"ACCT","id":"REC","action":"doc_created","type":"call_recording","email":"me@example.com","token":"REPLACE_WITH_SHARED_SECRET"}'
```

A correct token attempts the KAZOO fetch + email; a wrong/missing token returns
`403`.

## How it works

1. KAZOO POSTs the recording-doc event to `https://<host><path>`.
2. The receiver checks the shared `token` (carried in the webhook's
   `custom_data`) and rejects mismatches with `403`.
3. It exchanges the configured account **API key** for an auth token
   (`PUT /api_auth`), since webhook payloads do not include one.
4. It downloads the media (`GET /accounts/{id}/recordings/{id}` with
   `Accept: audio/mpeg`).
5. It emails the audio as an attachment via SMTP.

The recipient address and shared token travel with each event in the webhook's
`custom_data`, so the receiver itself is generic.

## Security

The `token` is **not a strong secret**. It is configured in the Monster UI
`app.js` (`appFlags.emailWebhook.token`), which is a static file served to the
browser, so anyone who can load the app — or fetch the JS file — can read it. It
only stops casual/unauthenticated POSTs to the endpoint.

The real control is restricting who can reach the receiver. Set `allowed_ips`
in `[security]` to the KAZOO cluster node IPs (the receiver rejects any other
peer with `403`), and/or add a host firewall rule limiting the listen port to
those nodes. If the receiver sits behind a reverse proxy, every request appears
to come from the proxy — enforce the allowlist at the proxy or firewall layer
instead.