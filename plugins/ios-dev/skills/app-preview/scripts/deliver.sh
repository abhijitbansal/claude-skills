#!/usr/bin/env bash
#
# app-preview: deliver a screenshot to the user's iPhone via a
# two-channel hybrid. This is the LAST-RESORT delivery path. The order a
# caller should try (see commands/preview.md and fix.md):
#   1. the host's file-send tool (SendUserFile), when the host has one;
#   2. the imessage plugin's reply tool with the PNG attached (to verify:
#      it may go through the same Messages path rejected below);
#   3. this script (iCloud Drive copy + iMessage text ping).
# On a desktop session the user is looking at the screen, so none of it is
# needed.
#
# The hybrid:
#   1. iMessage TEXT to self — push notification so the user knows a
#      new snapshot is ready, with the filename for disambiguation.
#   2. iCloud Drive copy into $(basename "${APP_PREVIEW_ROOT}")/<branch>/ — the actual
#      image, viewable full-size from Files app.
#
# Why hybrid? AppleScript file-attachment sends to self via iMessage are
# silently rejected by Apple's server (verified: same destination delivers
# manual sends and AppleScript text sends, but not AppleScript attachments).
# Plain text works. So we use iMessage for the ping and iCloud Drive for
# the bytes — two-tap on the phone: notification → open Files → tap file.
#
# Output is organized by branch: each delivery lands in
# $(basename "${APP_PREVIEW_ROOT}")/<branch>/<basename> (slashes in the branch name
# flattened to '--', see branch-dir.sh). The user can flip branches and see
# exactly which screenshots belong to which line of work.
#
# Destination resolution for iMessage:
#   1. $IMESSAGE_TO env var (export it in the shell profile Claude Code inherits)
#   2. <skill-dir>/.imessage-to (first non-blank line; inside the plugin cache
#      for a marketplace install, so an update wipes it)
#
# Flags:
#   --no-ping    Skip the iMessage text. Useful when the user already knows
#                a snap is coming (e.g., they ran /preview seconds ago) and
#                doesn't need another notification.
#   --no-icloud  Skip the iCloud Drive copy. Rarely useful — just the ping
#                with no image to fetch. Mainly for testing.
#
# Usage:
#   deliver.sh <path-to-file>
#   deliver.sh --no-ping <path-to-file>
# Exactly one file; any unknown --flag or a second file exits 2.

set -euo pipefail

ACCEPTED="--no-ping, --no-icloud, -h|--help, <path-to-file>"
DO_PING=true
DO_ICLOUD=true
FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-ping)   DO_PING=false; shift ;;
    --no-icloud) DO_ICLOUD=false; shift ;;
    -h|--help)   sed -n '2,45p' "$0"; exit 0 ;;
    -*)          echo "[deliver] unknown flag '$1' (accepted: ${ACCEPTED})" >&2; exit 2 ;;
    *)
      [[ -z "$FILE" ]] || { echo "[deliver] one file only, got a second: '$1' (accepted: ${ACCEPTED})" >&2; exit 2; }
      FILE="$1"; shift ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"
APP_NAME_LC="$(echo "${APP_NAME}" | tr '[:upper:]' '[:lower:]')"

# shellcheck source=branch-dir.sh
source "$SCRIPT_DIR/branch-dir.sh"

# CONFIG sits next to the skill (legacy fallback; prefer $IMESSAGE_TO).
# ICLOUD_DIR is $HOME-relative so it works on any Mac with iCloud Drive enabled.
CONFIG="$SCRIPT_DIR/../.imessage-to"
BRANCH_SLUG="$(app_branch_slug)"
PREVIEW_FOLDER="$(basename "${APP_PREVIEW_ROOT}")"
ICLOUD_ROOT="${HOME}/Library/Mobile Documents/com~apple~CloudDocs/${PREVIEW_FOLDER}"
ICLOUD_DIR="$ICLOUD_ROOT/$BRANCH_SLUG"

if [[ -z "$FILE" ]]; then
  echo "[deliver] Usage: $0 [--no-ping] [--no-icloud] <path-to-file>" >&2
  exit 1
fi
if [[ ! -f "$FILE" ]]; then
  echo "[deliver] File not found: $FILE" >&2
  exit 1
fi

BASENAME="$(basename "$FILE")"
ICLOUD_OK=false
PING_OK=false

# --- iCloud Drive copy ---
if $DO_ICLOUD; then
  if [[ ! -d "$ICLOUD_DIR" ]]; then
    if ! mkdir -p "$ICLOUD_DIR" 2>/dev/null; then
      echo "[deliver] Could not create $ICLOUD_DIR — is iCloud Drive enabled?" >&2
    fi
  fi
  if [[ -d "$ICLOUD_DIR" ]]; then
    if cp "$FILE" "$ICLOUD_DIR/$BASENAME"; then
      ICLOUD_OK=true
    else
      echo "[deliver] iCloud Drive copy failed for $BASENAME" >&2
    fi
  fi
fi

# --- iMessage text ping ---
if $DO_PING; then
  TO="${IMESSAGE_TO:-}"
  if [[ -z "$TO" && -f "$CONFIG" ]]; then
    TO="$(grep -v '^[[:space:]]*\(#\|$\)' "$CONFIG" 2>/dev/null | head -1 | tr -d '[:space:]')"
  fi
  if [[ -z "$TO" ]]; then
    echo "[deliver] iMessage ping skipped: no destination set (export IMESSAGE_TO='you@apple-id.com' in the shell profile Claude Code inherits)" >&2
  else
    if $ICLOUD_OK; then
      MESSAGE="${APP_NAME} preview: $BASENAME — Files → iCloud Drive → ${PREVIEW_FOLDER} → $BRANCH_SLUG"
    else
      MESSAGE="${APP_NAME} preview: $BASENAME — (iCloud copy failed, image stayed on Mac)"
    fi
    # Escape any double-quotes in the message for the AppleScript heredoc.
    # In practice BASENAME is timestamp+label so it shouldn't contain quotes,
    # but defensive replacement keeps the script robust if labels change.
    ESCAPED_MSG="${MESSAGE//\"/\\\"}"
    if osascript <<EOF 2>/dev/null
tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to participant "$TO" of targetService
    send "$ESCAPED_MSG" to targetBuddy
end tell
EOF
    then
      PING_OK=true
    else
      echo "[deliver] iMessage ping failed (AppleScript error)" >&2
    fi
  fi
fi

# --- Summary ---
if $ICLOUD_OK && $PING_OK; then
  echo "Delivered: ${PREVIEW_FOLDER}/$BRANCH_SLUG/$BASENAME (pinged $TO via iMessage)"
elif $ICLOUD_OK; then
  echo "Delivered to iCloud Drive: ${PREVIEW_FOLDER}/$BRANCH_SLUG/$BASENAME (no ping)"
elif $PING_OK; then
  echo "Pinged $TO via iMessage (image not copied to iCloud)"
else
  echo "[deliver] Both channels failed — file still at $FILE" >&2
  exit 1
fi
