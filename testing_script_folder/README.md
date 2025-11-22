# ServiceNow Automation Prototype

This folder contains a Playwright-based prototype for automating ServiceNow list filtering and capturing structured event logs. The script logs in with provided credentials, navigates to the requested module, applies filters, and optionally exports the visible table rows.

## 1. Setup

1. Create and activate a Python 3.10+ virtualenv.
2. Install dependencies and the bundled browsers:
   ```bash
   pip install -r requirements.txt
   playwright install chromium
   ```
3. Provide credentials via environment variables (recommended):
   ```bash
   export SERVICENOW_USERNAME="admin"
   export SERVICENOW_PASSWORD="Tensor@34"
   ```
   The config also ships with fallback values so the above step is optional during initial testing.

## 2. Configure tasks

1. Copy `config.example.yaml` to `config.yaml`.
2. Adjust `instance_url`, navigation hints, filters, and output paths as needed. Each task can either:
   - Supply `encoded_query` to inject a ready-made ServiceNow encoded query, or
   - Provide `filter_conditions` so the script drives the UI condition builder.
3. The sample task replicates the workflow: open “All Assets” and filter for consumable items assigned to Valentine Granberry with blank asset tags, asset functions, and serial numbers.

## 3. Run

Execute the automation with:
```bash
python service_now_automation.py --config config.yaml
```

The script produces:
- `logs/login_events.jsonl` containing login/navigation actions.
- Per-task event logs (JSONL) that mirror the interaction sequence and can be adapted to match your existing plugin schema.
- Optional result captures (`logs/filter_asset_list_results.json`) with the table rows currently rendered in the UI.

## 4. Extending

- Add new task objects to the `tasks` list in the config to chain additional automations.
- Update selectors inside `service_now_automation.py` if your ServiceNow theme uses different markup. The event logs will help you pinpoint where adjustments are required.
- If you need a stricter event schema, adjust the `EventLogger` class to serialize exactly what your downstream consumers expect.
