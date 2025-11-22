#!/usr/bin/env python3
"""
Drive the ServiceNow 'filter_asset_list' task in a tab where
the Chrome extension is already recording, so the resulting
intermediate payload has the exact same event format as a
manual run.

Usage (high-level):
1) Start Chrome with your extension and remote debugging, e.g.
   /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\
     --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-recorder
2) Open ServiceNow in that Chrome and start recording the task
   from the extension popup (so recorder.js is active).
3) Run this script from the repo root:
   python3 testing_script_folder/drive_filter_with_extension.py
4) Stop recording from the popup when the automation finishes.
   The backend will write intermediate/<ISO>/payload.json in the
   same format as a manual recording.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, Optional

from playwright.sync_api import sync_playwright, Page  # type: ignore

from service_now_automation import (  # type: ignore
    ServiceNowAutomation,
    EventLogger,
    load_config,
)


PROJECT_ROOT = Path(__file__).resolve().parent.parent
TESTING_ROOT = PROJECT_ROOT / "testing_script_folder"
CONFIG_PATH = TESTING_ROOT / "config.yaml"


def find_servicenow_page(page_list, instance_prefix: str) -> Optional[Page]:
    for page in page_list:
        try:
            url = page.url
        except Exception:
            continue
        if instance_prefix in url:
            return page
    return None


def main() -> int:
    if not CONFIG_PATH.exists():
        print(f"Config not found at {CONFIG_PATH}", file=sys.stderr)
        return 1

    config: Dict[str, Any] = load_config(CONFIG_PATH)
    working_dir = CONFIG_PATH.parent
    automation = ServiceNowAutomation(config=config, working_dir=working_dir)

    instance_url = automation.instance_url.rstrip("/")

    with sync_playwright() as p:
        # Connect to an existing Chrome with the extension loaded
        try:
            browser = p.chromium.connect_over_cdp("http://localhost:9222")
        except Exception as exc:
            print(f"Failed to connect to Chrome over CDP: {exc}", file=sys.stderr)
            return 1

        pages = []
        for ctx in browser.contexts:
            pages.extend(ctx.pages)

        page = find_servicenow_page(pages, instance_url)
        if page is None:
            print(
                f"No existing tab found for instance {instance_url}. "
                "Open ServiceNow in Chrome with the extension active, then retry.",
                file=sys.stderr,
            )
            return 1

        page.bring_to_front()

        # First ensure we are logged in using the same logic as the automation script.
        login_logger = EventLogger(
            automation._resolve_output_path("logs/login_bridge_events.jsonl")
        )
        try:
            automation._login(page, login_logger)
        finally:
            login_logger.flush()

        # Use the existing task configuration to drive the filter task.
        if not automation.tasks:
            print("No tasks defined in config.yaml", file=sys.stderr)
            return 1

        task_cfg = automation.tasks[0]
        task_name = task_cfg.get("name", "filter_asset_list")

        logger = EventLogger(
            automation._resolve_output_path(f"logs/{task_name}_bridge_events.jsonl")
        )
        logger.log("task_started", task=task_name, via="extension_bridge")
        try:
            automation._execute_task(page, task_cfg, logger)
            logger.log("task_completed", task=task_name, status="success")
        except Exception as exc:  # pylint: disable=broad-except
            logger.log("task_failed", task=task_name, error=str(exc))
            logger.flush()
            raise
        finally:
            logger.flush()

    # At this point, the extension will have recorded all events.
    # Use the popup to stop recording; the backend will write
    # intermediate/<ISO>/payload.json in the usual format.
    return 0


if __name__ == "__main__":
    sys.exit(main())
