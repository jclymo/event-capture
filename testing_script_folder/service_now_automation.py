#!/usr/bin/env python3
"""
Automate ServiceNow navigation and filtering with Playwright.

The script reads a YAML/JSON configuration file describing login
credentials and the ordered set of tasks to perform. Each task can log
structured browser events and optionally capture table results in JSON.

Example usage:
    python service_now_automation.py --config config.example.yaml
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin

try:
    import yaml  # type: ignore
    _HAS_YAML = True
except ImportError:  # pragma: no cover - optional dependency
    yaml = None
    _HAS_YAML = False

from playwright.sync_api import (  # type: ignore
    Error as PlaywrightError,
    Frame,
    Page,
    TimeoutError as PlaywrightTimeoutError,
    ElementHandle,
    sync_playwright,
)


@dataclass
class Credentials:
    username: str
    password: str


class EventLogger:
    """Collect structured events and persist them to JSONL."""

    def __init__(self, output_path: Path) -> None:
        self.output_path = output_path
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self._events: List[Dict[str, Any]] = []

    def log(self, action: str, **details: Any) -> None:
        event = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action": action,
            "details": details,
        }
        self._events.append(event)

    def flush(self) -> None:
        if not self._events:
            return
        with self.output_path.open("w", encoding="utf-8") as fh:
            for event in self._events:
                json.dump(event, fh)
                fh.write("\n")


class ServiceNowAutomation:
    """Coordinator that executes the configured ServiceNow tasks."""

    def __init__(self, config: Dict[str, Any], working_dir: Path) -> None:
        self.config = config
        self.working_dir = working_dir
        self.instance_url = config.get("instance_url", "").rstrip("/")
        if not self.instance_url:
            raise ValueError("instance_url is required in the configuration.")
        self.start_url = config.get("start_url") or self.instance_url
        self.credentials = self._resolve_credentials(config.get("credentials", {}))
        self.playwright_settings = config.get("playwright", {})
        self.tasks = config.get("tasks", [])
        if not isinstance(self.tasks, list):
            raise ValueError("tasks must be a list.")

    def run(self) -> None:
        headless = bool(self.playwright_settings.get("headless", False))
        slow_mo = int(self.playwright_settings.get("slow_mo_ms", 0))
        viewport = self.playwright_settings.get("viewport", {})
        width = viewport.get("width")
        height = viewport.get("height")

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=headless, slow_mo=slow_mo)
            context_kwargs: Dict[str, Any] = {}
            if width and height:
                context_kwargs["viewport"] = {"width": int(width), "height": int(height)}
            context = browser.new_context(**context_kwargs)

            # Inject BrowserGym and a standalone recorder into all frames for rich event capture.
            try:
                project_root = self.working_dir.parent
                browsergym_path = project_root / "extension" / "browsergym-inject.js"
                standalone_recorder_path = self.working_dir / "standalone_recorder.js"
                if browsergym_path.exists():
                    context.add_init_script(path=str(browsergym_path))
                if standalone_recorder_path.exists():
                    context.add_init_script(path=str(standalone_recorder_path))
            except PlaywrightError as exc:
                print(f"[testing] Failed to add init scripts: {exc}", file=sys.stderr)

            page = context.new_page()

            # Reuse a dedicated login logger to capture initial navigation.
            login_logger = EventLogger(self._resolve_output_path("logs/login_events.jsonl"))
            try:
                self._login(page, login_logger)
            finally:
                login_logger.flush()

            for raw_task in self.tasks:
                if not isinstance(raw_task, dict):
                    raise ValueError(f"Task entries must be objects, received: {raw_task}")
                task_name = raw_task.get("name", "unnamed_task")
                logger = EventLogger(self._resolve_output_path(raw_task.get("event_log", f"logs/{task_name}_events.jsonl")))
                logger.log("task_started", task=task_name)
                try:
                    self._execute_task(page, raw_task, logger)
                    logger.log("task_completed", task=task_name, status="success")
                except Exception as exc:  # pylint: disable=broad-except
                    logger.log("task_failed", task=task_name, error=str(exc))
                    logger.flush()
                    raise
                logger.flush()

            # Try to pull extension-style events from the standalone recorder and persist them.
            recorded_events: List[Dict[str, Any]] = []
            try:
                debug_main = page.evaluate(
                    "() => ({ hasRecorder: !!window.__testingRecorderInitialized, "
                    "hasEvents: !!window.__testingEvents, "
                    "len: (window.__testingEvents || []).length })"
                )
                print(f"[testing] main frame recorder state: {debug_main}")
            except PlaywrightError:
                print("[testing] unable to read recorder state from main frame", file=sys.stderr)

            try:
                for frame in page.context.pages[0].frames:
                    try:
                        frame_debug = frame.evaluate(
                            "() => ({ url: window.location.href, "
                            "hasRecorder: !!window.__testingRecorderInitialized, "
                            "hasEvents: !!window.__testingEvents, "
                            "len: (window.__testingEvents || []).length })"
                        )
                        print(f"[testing] frame recorder state: {frame_debug}")
                    except PlaywrightError:
                        frame_debug = None
                    try:
                        frame_events = frame.evaluate("() => (window.__testingEvents || [])")
                    except PlaywrightError:
                        frame_events = []
                    if isinstance(frame_events, list):
                        recorded_events.extend(frame_events)
            except PlaywrightError:
                recorded_events = []

            if recorded_events:
                events_path = self._resolve_output_path("logs/filter_asset_list_extension_style_events.json")
                events_path.parent.mkdir(parents=True, exist_ok=True)
                with events_path.open("w", encoding="utf-8") as fh:
                    json.dump(recorded_events, fh, indent=2)

            context.close()
            browser.close()

    def _resolve_credentials(self, cfg: Dict[str, Any]) -> Credentials:
        username = ""
        password = ""
        if "username_env" in cfg:
            username = os.getenv(cfg["username_env"], "")
        if "password_env" in cfg:
            password = os.getenv(cfg["password_env"], "")

        fallback = cfg.get("fallback", {})
        if not username:
            username = fallback.get("username", "")
        if not password:
            password = fallback.get("password", "")

        if not username or not password:
            raise ValueError("Credentials could not be resolved. Provide env vars or fallback values.")
        return Credentials(username=username, password=password)

    def _resolve_output_path(self, relative_path: str) -> Path:
        return (self.working_dir / relative_path).resolve()

    def _login(self, page: Page, logger: EventLogger) -> None:
        try:
            logger.log("navigate", url=self.start_url)
            page.goto(self.start_url, wait_until="load")
            if self._is_logged_in(page):
                logger.log("login_skipped", reason="Existing session detected.")
                return

            username_input = page.wait_for_selector("input#user_name", timeout=15000)
            password_input = page.wait_for_selector("input#user_password", timeout=15000)
            username_input.fill(self.credentials.username)
            logger.log("fill", field="username", selector="input#user_name")
            password_input.fill(self.credentials.password)
            logger.log("fill", field="password", selector="input#user_password", value_masked=True)
            page.click("button#sysverb_login")
            logger.log("click", selector="button#sysverb_login")
            page.wait_for_load_state("load", timeout=40000)
            # In case the classic UI redirects into frame-based layout, allow additional load time.
            page.wait_for_timeout(2000)
            if not self._is_logged_in(page):
                raise RuntimeError("Login appears to have failed; still on login screen.")
            logger.log("login_success")
        except PlaywrightTimeoutError as exc:
            logger.log("login_failed", reason="timeout", error=str(exc))
            raise RuntimeError("Timeout while attempting to log in.") from exc
        except PlaywrightError as exc:
            logger.log("login_failed", reason="playwright_error", error=str(exc))
            raise
        except Exception as exc:  # pylint: disable=broad-except
            logger.log("login_failed", reason="unexpected_error", error=str(exc))
            raise

    def _is_logged_in(self, page: Page) -> bool:
        """Rudimentary detection that we are past the login screen."""
        try:
            page.wait_for_selector("input#user_name", timeout=2000)
            return False
        except PlaywrightTimeoutError:
            # If the login field is gone and the main nav is present, assume success.
            return bool(page.locator("nav#filter").count() or page.frames)

    def _execute_task(self, page: Page, task_cfg: Dict[str, Any], logger: EventLogger) -> None:
        task_type = task_cfg.get("type", "list_filter")
        if task_type != "list_filter":
            raise NotImplementedError(f"Unsupported task type: {task_type}")

        nav_cfg = task_cfg.get("navigation", {})
        self._open_module(page, nav_cfg, logger)

        frame = self._wait_for_main_frame(page, logger)
        filter_conditions = task_cfg.get("filter_conditions", [])
        encoded_query = task_cfg.get("encoded_query")
        if encoded_query:
            self._apply_encoded_query(frame, encoded_query, logger)
        elif filter_conditions:
            self._apply_filter_conditions(frame, filter_conditions, logger)
        else:
            logger.log("skip_filter", reason="No encoded_query or filter_conditions provided.")

        if task_cfg.get("capture_table_results"):
            results_output = task_cfg.get("results_output", "logs/results.json")
            data = self._extract_table_results(frame, logger)
            results_path = self._resolve_output_path(results_output)
            results_path.parent.mkdir(parents=True, exist_ok=True)
            with results_path.open("w", encoding="utf-8") as fh:
                json.dump({"fetched_at": datetime.now(timezone.utc).isoformat(), "rows": data}, fh, indent=2)
            logger.log("results_saved", path=str(results_path), row_count=len(data))

    def _open_module(self, page: Page, nav_cfg: Dict[str, Any], logger: EventLogger) -> None:
        module_url = nav_cfg.get("module_url")
        if module_url:
            target_url = self._normalize_url(module_url)
            logger.log("navigate", url=target_url, via="module_url")
            page.goto(target_url, wait_until="load")
            page.wait_for_load_state("networkidle")
            return

        search_term = nav_cfg.get("search_term")
        module_path = nav_cfg.get("module_path") or []
        menu_button_label = nav_cfg.get("application_menu_button_label")

        if menu_button_label:
            try:
                page.get_by_role("button", name=menu_button_label, exact=False).click()
                logger.log("click", selector="button", label=menu_button_label)
            except PlaywrightError:
                logger.log("menu_toggle_failed", label=menu_button_label)

        if search_term:
            try:
                search_input = page.get_by_role("textbox", name="Filter navigator")
                search_input.fill(search_term)
                logger.log("fill", selector="Filter navigator", text=search_term)
                page.wait_for_timeout(1200)
            except PlaywrightError:
                logger.log("navigator_search_failed", search_term=search_term)

        for module_name in module_path:
            try:
                locator = page.get_by_role("treeitem", name=module_name, exact=False)
                if locator.count():
                    locator.first.click()
                    logger.log("click", element="treeitem", label=module_name)
                    page.wait_for_timeout(800)
                    continue
                link = page.get_by_role("link", name=module_name, exact=False)
                link.first.click()
                logger.log("click", element="link", label=module_name)
                page.wait_for_load_state("load")
            except PlaywrightError as exc:
                logger.log("module_navigation_failed", module=module_name, error=str(exc))
                break

    def _wait_for_main_frame(self, page: Page, logger: EventLogger) -> Frame:
        try:
            page.wait_for_timeout(1500)
            frame = page.frame(name="gsft_main")
            if frame:
                logger.log("frame_detected", frame="gsft_main")
                return frame
            # Fallback: choose first non-main frame.
            for candidate in page.frames:
                if candidate.name and candidate.name != page.main_frame.name:
                    logger.log("frame_detected", frame=candidate.name)
                    return candidate
            logger.log("frame_fallback", reason="Using main frame as no sub-frame detected.")
            return page.main_frame
        except PlaywrightError as exc:
            raise RuntimeError("Unable to detect main content frame.") from exc

    def _apply_encoded_query(self, frame: Frame, encoded_query: str, logger: EventLogger) -> None:
        logger.log("apply_encoded_query", query=encoded_query)
        script = """
            (encodedQuery) => {
                if (typeof g_list === "undefined") {
                    throw new Error("g_list is undefined; not on a list view.");
                }
                g_list.setFilterAndRefresh(encodedQuery);
                return true;
            }
        """
        frame.evaluate(script, encoded_query)
        frame.wait_for_load_state("load")
        frame.wait_for_timeout(1500)

    def _apply_filter_conditions(self, frame: Frame, conditions: Iterable[Dict[str, Any]], logger: EventLogger) -> None:
        """Interact with the list filter builder to configure conditions."""
        toggle_selectors = [
            "a.list_filter_toggle",
            "button.list-filter-button",
            "button[aria-label='Show / hide filter']",
            "button[title='Filter']",
        ]
        toggled = False
        for selector in toggle_selectors:
            try:
                button = frame.query_selector(selector)
                if button:
                    button.click()
                    logger.log("click", selector=selector)
                    frame.wait_for_timeout(400)
                    toggled = True
                    break
            except PlaywrightError:
                continue

        if not toggled:
            logger.log("filter_toggle_warning", message="Could not explicitly open filter builder; attempting to proceed.")

        try:
            frame.wait_for_selector("tr.filter_row_condition", timeout=7000)
        except PlaywrightTimeoutError as exc:
            logger.log("filter_unavailable", error=str(exc))
            return

        for idx, condition in enumerate(conditions):
            rows = frame.query_selector_all("tr.filter_row_condition")
            while len(rows) <= idx:
                add_button = rows[-1].query_selector("button[name='and-button']")
                if add_button:
                    add_button.click()
                    logger.log("click", selector="button[name='and-button']", index=len(rows) - 1)
                    frame.wait_for_timeout(300)
                    rows = frame.query_selector_all("tr.filter_row_condition")
                else:
                    logger.log("condition_row_missing", index=idx, selector="tr.filter_row_condition")
                    break

            if idx >= len(rows):
                logger.log("condition_row_missing", index=idx, selector="tr.filter_row_condition")
                continue

            self._configure_condition_row(frame, rows[idx], condition, idx, logger)

        run_selectors = [
            "button[name='run']",  # classic UI
            "button[aria-label='Run']",  # Polaris legacy
            "button[aria-label='Run filter']",
            "button.list-filter-button.run",
        ]
        for selector in run_selectors:
            try:
                run_button = frame.query_selector(selector)
                if run_button:
                    run_button.click()
                    logger.log("click", selector=selector)
                    frame.wait_for_load_state("load")
                    frame.wait_for_timeout(2000)
                    return
            except PlaywrightError:
                continue

        logger.log("filter_run_warning", message="Could not locate explicit run button; results may be stale.")

    def _configure_condition_row(
        self,
        frame: Frame,
        row: ElementHandle,
        condition: Dict[str, Any],
        index: int,
        logger: EventLogger,
    ) -> None:
        field_label = condition.get("field")
        operator_label = condition.get("operator")
        value = condition.get("value")

        field_select = row.query_selector("select.filter_type, select.filerTableSelect.filter_type")
        if field_select and field_label:
            try:
                field_select.select_option(label=field_label)
                logger.log("select", selector="field", label=field_label, index=index)
                frame.wait_for_timeout(200)
            except PlaywrightError:
                logger.log("select_failed", selector="field", label=field_label, index=index)

        operator_select = row.query_selector("select.condOperator")
        if operator_select and operator_label:
            try:
                operator_select.select_option(label=operator_label)
                logger.log("select", selector="operator", label=operator_label, index=index)
                frame.wait_for_timeout(200)
            except PlaywrightError:
                logger.log("select_failed", selector="operator", label=operator_label, index=index)

        if value is not None:
            self._set_condition_value(frame, row, value, index, logger)

    def _set_condition_value(
        self,
        frame: Frame,
        row: ElementHandle,
        value: str,
        index: int,
        logger: EventLogger,
    ) -> None:
        value_select = row.query_selector("select.filerTableSelect:not(.filter_type):not(.condOperator)")
        if value_select:
            try:
                try:
                    value_select.select_option(label=value)
                except PlaywrightError:
                    value_select.select_option(value=value)
                logger.log("select", selector="value_select", label=value, index=index)
                frame.wait_for_timeout(200)
                return
            except PlaywrightError:
                logger.log("select_failed", selector="value_select", label=value, index=index)

        input_selectors = [
            "input.filter-reference-input",
            "input.filerTableInput:not([type='hidden'])",
            "textarea.filerTableInput",
        ]
        for selector in input_selectors:
            try:
                input_el = row.query_selector(selector)
            except PlaywrightError:
                input_el = None
            if input_el:
                try:
                    input_el.fill(value)
                    logger.log("fill", selector=selector, text=value, index=index)
                    frame.wait_for_timeout(400)
                except PlaywrightError as exc:
                    logger.log("fill_failed", selector=selector, text=value, index=index, error=str(exc))
                    continue

                classes = input_el.get_attribute("class") or ""
                if "filter-reference-input" in classes:
                    if not self._select_autocomplete_option(frame, value, index, logger):
                        if not self._use_reference_lookup(frame, row, value, index, logger):
                            logger.log("reference_lookup_warning", value=value, index=index)
                else:
                    try:
                        input_el.press("Enter")
                        logger.log("press", key="Enter", selector=selector, index=index)
                    except PlaywrightError:
                        pass
                return

        logger.log("value_input_missing", index=index, value=value)

    def _select_autocomplete_option(self, frame: Frame, value: str, index: int, logger: EventLogger) -> bool:
        """Attempt to choose an autocomplete suggestion after typing into a reference input."""
        try:
            suggestions = frame.query_selector_all("div.ac_results li, ul.ac_results li")
        except PlaywrightError:
            suggestions = []

        if not suggestions:
            return False

        chosen_text = None
        for option in suggestions:
            try:
                text = (option.inner_text() or "").strip()
            except PlaywrightError:
                continue
            if value.lower() in text.lower():
                option.click()
                chosen_text = text
                break
        if chosen_text is None:
            try:
                suggestions[0].click()
                chosen_text = (suggestions[0].inner_text() or "").strip()
            except PlaywrightError:
                return False

        logger.log("click", selector="div.ac_results li", label=chosen_text, index=index)
        frame.wait_for_timeout(300)
        return True

    def _use_reference_lookup(
        self,
        frame: Frame,
        row: ElementHandle,
        value: str,
        index: int,
        logger: EventLogger,
    ) -> bool:
        """Fallback to the reference lookup modal when autocomplete has no matches."""
        try:
            lookup_button = row.query_selector("button.icon-search")
        except PlaywrightError:
            lookup_button = None
        if not lookup_button:
            return False

        page = frame.page
        context = page.context
        try:
            with context.expect_page() as popup_info:
                lookup_button.click()
            lookup_page = popup_info.value
        except PlaywrightError as exc:
            logger.log("lookup_open_failed", value=value, index=index, error=str(exc))
            return False

        try:
            lookup_page.wait_for_load_state("load")
            lookup_page.wait_for_timeout(400)
            search_input = lookup_page.query_selector("input[type='search']")
            if search_input:
                search_input.fill(value)
                search_input.press("Enter")
                logger.log("lookup_search", value=value, index=index)
                lookup_page.wait_for_timeout(800)

            rows = lookup_page.query_selector_all("table.data_list_table tbody tr")
            if not rows:
                logger.log("lookup_no_results", value=value, index=index)
                lookup_page.close()
                return False

            chosen_text = None
            for row_el in rows:
                try:
                    link = row_el.query_selector("td:nth-child(3) a") or row_el.query_selector("a")
                except PlaywrightError:
                    link = None
                if not link:
                    continue
                try:
                    text = (link.inner_text() or "").strip()
                except PlaywrightError:
                    text = ""
                try:
                    link.click()
                except PlaywrightError:
                    pass
                chosen_text = text or value
                break

            try:
                lookup_page.wait_for_timeout(1000)
            except PlaywrightError:
                pass
            if not lookup_page.is_closed():
                try:
                    lookup_page.close()
                except PlaywrightError:
                    pass

            if chosen_text:
                logger.log("lookup_select", value=chosen_text, index=index)
                frame.wait_for_timeout(500)
                return True
            return False
        except PlaywrightError as exc:
            logger.log("lookup_interaction_failed", value=value, index=index, error=str(exc))
            try:
                lookup_page.close()
            except PlaywrightError:
                pass
            return False

    def _extract_table_results(self, frame: Frame, logger: EventLogger, max_rows: int = 50) -> List[Dict[str, Any]]:
        """Extract visible table rows into JSON-friendly structures."""
        table_selectors = [
            "table.data_list_table",
            "table.list_table",
            "table.list2_table",
        ]
        table = None
        for selector in table_selectors:
            table = frame.query_selector(selector)
            if table:
                logger.log("table_detected", selector=selector)
                break
        if not table:
            logger.log("table_missing", message="Could not find results table.")
            return []

        headers = []
        header_cells = table.query_selector_all("thead th")
        for cell in header_cells:
            text = (cell.inner_text() or "").strip()
            if text:
                headers.append(text)

        rows_data: List[Dict[str, Any]] = []
        body_rows = table.query_selector_all("tbody tr")
        for row in body_rows[:max_rows]:
            cells = row.query_selector_all("td")
            if not cells:
                continue
            row_dict: Dict[str, Any] = {}
            for idx, cell in enumerate(cells):
                header = headers[idx] if idx < len(headers) else f"column_{idx}"
                value = (cell.inner_text() or "").strip()
                row_dict[header] = value
            rows_data.append(row_dict)

        logger.log("rows_extracted", count=len(rows_data))
        return rows_data

    def _normalize_url(self, partial: str) -> str:
        if partial.startswith("http://") or partial.startswith("https://"):
            return partial
        base_root = urljoin(self.instance_url, "/")
        if partial.startswith("/"):
            return urljoin(base_root, partial.lstrip("/"))
        return urljoin(base_root, partial)


def load_config(path: Path) -> Dict[str, Any]:
    raw_text = path.read_text(encoding="utf-8")
    suffix = path.suffix.lower()
    if suffix in {".yaml", ".yml"}:
        if not _HAS_YAML:
            raise RuntimeError("PyYAML is required to parse YAML configs. Install with `pip install pyyaml`.")
        return yaml.safe_load(raw_text)
    if suffix == ".json":
        return json.loads(raw_text)
    # Attempt YAML first, then JSON as fallback.
    if _HAS_YAML:
        try:
            return yaml.safe_load(raw_text)
        except yaml.YAMLError:
            pass
    return json.loads(raw_text)


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run ServiceNow automation tasks.")
    parser.add_argument("--config", required=True, help="Path to YAML or JSON configuration file.")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    config_path = Path(args.config).expanduser().resolve()
    if not config_path.exists():
        print(f"Config file not found: {config_path}", file=sys.stderr)
        return 1

    config = load_config(config_path)
    working_dir = config_path.parent

    automation = ServiceNowAutomation(config=config, working_dir=working_dir)
    automation.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
