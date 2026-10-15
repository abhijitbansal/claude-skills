# Live while you edit

For a page that updates itself while you change the spec or the data, serve it in watch mode:

```
node <skill-dir>/scripts/serve.mjs --watch dashboard.json --open
```

- It builds once, serves the result on `127.0.0.1` and rebuilds when the spec or any file source (csv, parquet, json, duckdb, sqlite) is saved. The open page reloads on its own.
- Postgres and MySQL sources have no file to watch: add `--interval <seconds>` (5 to 86400), e.g. `--interval 60`, to rebuild on a timer. `--interval` also works for file sources.
- The page has a **Rebuild now** button for an immediate rebuild.
- If the first build fails, it prints the errors and exits 1 without starting the server; a usage or IO problem on that first build (missing `node_modules`, an unwritable `dist`, a busy port) exits 2. After that, a failed build (invalid spec, half-written data file) shows an error banner and keeps the last good page. The next good save rebuilds.
- `--theme <name>` picks a theme (it wins over the spec's `theme`). `--allow-outside` and `--timeout <seconds>` work as for build; `--port <n>` and `--open` are serve options.
- Only the served copy is live: it adds `connect-src 'self'` to the CSP for the event stream. `dist/index.html` on disk is the normal static page (`default-src 'none'`), and a page opened from disk (`file://`) is static: it never updates itself.

For scheduled rebuilds of the file on disk, use the sections below.

# Scheduled rebuilds

A refresh is `build.mjs` again: it re-runs every query and rewrites `dist/index.html`. No LLM, no network
(sqlite, postgres and mysql sources need their extension installed once with `setup.mjs`; see `schema.md`).
Use absolute paths in schedules, since cron and launchd start in a bare environment. Replace `<skill-dir>`
with the folder containing `SKILL.md` and `/abs/dashboard.json` with your spec.

Find your node path first: `command -v node`.

## cron (Linux, macOS)

`crontab -e`, then hourly at minute 5, logging to a file:

```
5 * * * * /usr/local/bin/node <skill-dir>/scripts/build.mjs /abs/dashboard.json >> $HOME/dashboard-build.log 2>&1
```

Postgres and MySQL sources read their connection string from an environment variable. Cron does not load your shell
profile, so set it on the line (`PG_URL='postgres://…' /usr/local/bin/node …`) or in a file only you can read.
Do not put it in `dashboard.json`.

## launchd (macOS)

Save as `~/Library/LaunchAgents/com.example.dashboard-build.plist` (rename `com.example` to your own prefix):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.example.dashboard-build</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string><skill-dir>/scripts/build.mjs</string>
    <string>/abs/dashboard.json</string>
  </array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/Users/you/Library/Logs/dashboard-build.log</string>
  <key>StandardErrorPath</key><string>/Users/you/Library/Logs/dashboard-build.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <!-- only for postgres/mysql sources; the plist is readable by your user, so keep it chmod 600 -->
    <key>PG_URL</key><string>postgres://user:pass@host:5432/db</string>
  </dict>
</dict>
</plist>
```

Replace `<skill-dir>` in the plist with the real absolute path (plists do not expand `~` or `$HOME`).

```
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.dashboard-build.plist
launchctl kickstart -k gui/$(id -u)/com.example.dashboard-build   # run now
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.example.dashboard-build.plist   # stop
```

## Serving the result

Point any static host at the `dist` folder, or run `node <skill-dir>/scripts/serve.mjs /abs/dist`. The page
shows its "Refreshed" time, and each chart shows the refresh time of its own query.
