# monster-ui-recordings-community
Monster UI Application: Provides an app to view and download call recordings for [KAZOO](https://www.2600hz.com/architecture)

## Screenshots
![recordings-list](metadata/screenshots/recordings1.PNG?raw=true)
![settings](metadata/screenshots/recordings2.PNG?raw=true)

## Installation

After cloning the repository, move the application to your Monster UI apps folder
```bash
mv monster-ui-recordings-community /var/www/html/monster-ui/apps/recordings-community
```

Instruct SELinux to allow httpd to read the folder
```bash
chcon -R -t httpd_sys_content_t /var/www/html/monster-ui/apps/recordings-community
```

Enable the recordings API
```bash
sup crossbar_maintenance start_module cb_recordings
```

Register the application with crossbar (replace the IP and port with your hostname and port)
```bash
sup crossbar_maintenance init_app '/var/www/html/monster-ui/apps/recordings-community' 'http://10.100.12.1:8000/v2'
```

## Emailing call recordings

The app can email each new call recording to a fixed address. 

### Configure the app

In `app.js`, set `appFlags.emailWebhook`:

- `receiverUri` — public URL of the receiver (see below), e.g.
  `https://hooks.example.com/recordings-email`
- `token` — shared secret; must match the receiver's `[security] token`

Enable the webhooks API on KAZOO if it is not already running:
```bash
sup crossbar_maintenance start_module cb_webhooks
```

### The receiver service

A standalone Python 3.6 (standard library only) service receives the webhook,
downloads the recording media from KAZOO, and emails it as an attachment. It
runs under systemd. See [`receiver/README.md`](receiver/README.md) for install,
configuration, and operation.

