#!/usr/bin/env python3
"""
Run the ServiceNow 'filter_asset_list' automation and save
the collected events in the same format as the intermediate
payloads produced by the existing extension pipeline.

- Does NOT modify any existing repo code.
- Uses the existing Playwright script + config.yaml.
- Reads testing_script_folder/logs/filter_asset_list_events.jsonl.
- Writes testing_script_folder/logs/training_runs/<task_id>.json
  shaped like intermediate/<iso>/payload.json:

  {
    "task": "...",
    "duration": 31,
    "events_recorded": 20,
    "start_url": "...",
    "end_url": "...",
    "data": [ ... ],
    "video_local_path": null,
    "video_server_path": null,
    "video_url": ""
  }
"""

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# Adjust if you place this script somewhere else
PROJECT_ROOT = Path(__file__).resolve().parent
TESTING_ROOT = PROJECT_ROOT / "testing_script_folder"
LOGS_DIR = TESTING_ROOT / "logs"
EVENTS_LOG = LOGS_DIR / "filter_asset_list_events.jsonl"
EXTENSION_STYLE_EVENTS_JSON = LOGS_DIR / "filter_asset_list_extension_style_events.json"

# Hard-coded for this specific task (matches your config.yaml/module_url)
TASK_NAME = "workarena.servicenow.filter-asset-list"
START_URL = "https://empmassimo23.service-now.com/navpage.do"
END_URL = "https://empmassimo23.service-now.com/now/nav/ui/classic/params/target/alm_asset_list.do"


def run_automation() -> None:
  """Run the existing Playwright automation script for filter_asset_list."""
  cmd = [
      sys.executable,
      str(TESTING_ROOT / "service_now_automation.py"),
      "--config",
      str(TESTING_ROOT / "config.yaml"),
  ]
  print("Running ServiceNow automation:", " ".join(cmd))
  subprocess.run(cmd, check=True)
  print("Automation completed.")


def load_events():
  """
  Load events captured during automation.

  Prefer the extension-style JSON array emitted by the standalone recorder;
  fall back to the EventLogger JSONL if needed.
  """
  events = []

  if EXTENSION_STYLE_EVENTS_JSON.exists():
    raw = EXTENSION_STYLE_EVENTS_JSON.read_text(encoding="utf-8")
    events = json.loads(raw)
  else:
    if not EVENTS_LOG.exists():
      raise FileNotFoundError(
        f"Events log not found: {EXTENSION_STYLE_EVENTS_JSON} or {EVENTS_LOG}"
      )
    for line in EVENTS_LOG.read_text(encoding="utf-8").splitlines():
      line = line.strip()
      if not line:
        continue
      events.append(json.loads(line))

  if not events:
    raise RuntimeError(
      f"No events found in {EXTENSION_STYLE_EVENTS_JSON if EXTENSION_STYLE_EVENTS_JSON.exists() else EVENTS_LOG}"
    )

  # Compute duration in seconds from first/last timestamp (handles ISO strings or numeric ms).
  first_ts = None
  last_ts = None
  for ev in events:
    ts_raw = ev.get("timestamp")
    ts = None
    if isinstance(ts_raw, str):
      try:
        ts = datetime.fromisoformat(ts_raw)
      except Exception:
        ts = None
    elif isinstance(ts_raw, (int, float)):
      try:
        ts = datetime.fromtimestamp(ts_raw / 1000.0, tz=timezone.utc)
      except Exception:
        ts = None
    if ts is None:
      continue
    if first_ts is None or ts < first_ts:
      first_ts = ts
    if last_ts is None or ts > last_ts:
      last_ts = ts

  if first_ts and last_ts:
    duration_seconds = max(0, int((last_ts - first_ts).total_seconds()))
  else:
    duration_seconds = 0

  return events, duration_seconds


def build_payload(events, duration_seconds):
  """
  Build a payload that matches the shape of intermediate payload.json:

  {
    "task": "...",
    "duration": 31,
    "events_recorded": 20,
    "start_url": "...",
    "end_url": "...",
    "data": [ ... ],
    "video_local_path": null,
    "video_server_path": null,
    "video_url": ""
  }
  """
  return {
      "task": TASK_NAME,
      "duration": max(duration_seconds, 1),
      "events_recorded": len(events),
      "start_url": START_URL,
      "end_url": END_URL,
      "data": events,
      "video_local_path": None,
      "video_server_path": None,
      "video_url": "",
  }


def save_payload(payload):
  """
  Save the payload into:
  - testing_script_folder/logs/training_runs/<task_id>.json
  - intermediate/<ISO>/payload.json (+ metadata.json)
  matching the existing intermediate format.
  """
  # 1) Save under testing_script_folder/logs/training_runs
  runs_dir = LOGS_DIR / "training_runs"
  runs_dir.mkdir(parents=True, exist_ok=True)
  task_id = f"task_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
  training_path = runs_dir / f"{task_id}.json"
  training_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
  print(f"Saved training payload (intermediate-format) to: {training_path}")

  # 2) Mirror into project_root/intermediate/<ISO>/payload.json like the server
  iso = datetime.now(timezone.utc).isoformat().replace(":", "-").replace(".", "-")
  intermediate_root = PROJECT_ROOT / "intermediate"
  folder = intermediate_root / iso
  folder.mkdir(parents=True, exist_ok=True)

  payload_path = folder / "payload.json"
  metadata_path = folder / "metadata.json"

  # payload.json is just the payload object
  payload_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

  metadata_json = {
      "savedAt": datetime.now(timezone.utc).isoformat(),
      "mongo": {
          "insertedId": None,
          "ok": False,
          "error": "generated_by_training_script",
      },
      "counts": {"events": len(payload.get("data", []))},
      "paths": {
          "payload": str(payload_path.resolve()),
          "metadata": str(metadata_path.resolve()),
      },
  }
  metadata_path.write_text(json.dumps(metadata_json, indent=2), encoding="utf-8")
  print(f"Also mirrored payload to intermediate folder: {payload_path}")


def main():
  # 1) Run the automation to collect fresh events
  run_automation()

  # 2) Load events from the JSONL log
  events, duration_seconds = load_events()

  # 3) Build an intermediate-style payload
  payload = build_payload(events, duration_seconds)

  # 4) Save into logs/training_runs in the same shape as intermediate payload.json
  save_payload(payload)


if __name__ == "__main__":
  main()
