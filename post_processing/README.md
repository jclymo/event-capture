# Post Processing Scripts

Process trace.json exported from the BrowserGym event capture extension.

## Quick Start

```bash
cd EXTENSION/event-capture/post_processing
uv sync
uv run python process_trace.py trace.json
    OR 
uv run python process_trace.py trace.json -o results --extract-html      
```

That's it! This generates all outputs in one go.

## Complete Workflow

### Step 1: Get trace.json

After recording with the extension, your data is auto-exported to:
```
Downloads/
└── tasks_{task_id}/
    ├── trace.json          # Event trace data
    ├── html_snapshots/     # HTML captures (if enabled)
    ├── video.webm          # Screen recording
    └── metadata.json       # Task metadata
```

### Step 2: Run Processing

```bash
# Basic - generates all outputs
uv run python process_trace.py trace.json

# With output folder
uv run python process_trace.py trace.json -o results/

# Also extract HTML snapshots to files
uv run python process_trace.py trace.json --extract-html
```

### Step 3: Check Results

```
./
├── trace_bgym_actions.json   # BrowserGym actions format
├── paired_trajectory.json    # Observation-action pairs + stats
├── context_prompt.txt        # LLM in-context learning prompt
└── html_snapshots/           # (if --extract-html)
    ├── snapshot_000_*.html
    ├── snapshot_001_*.html
    └── ...
```

## Example Output

```
============================================================
🚀 TRACE PROCESSING PIPELINE
============================================================

📂 Loading trace.json...

📊 DIAGNOSTIC STATISTICS
----------------------------------------
📝 Raw events: 50
📸 HTML observations: 7
🔑 Key events (filtered): 10
🔗 Pairs created: 10

📈 70% => observation:event ratio
   We collected 10 events, but only have 7 observations

✅ 40% => event-observation pairs with valid data-bid
❌ 60% => data-bid missing in observations

⚠️  Missing BID Details (first 5):
   Step 3: bid=role-button, type=click, element=-- choose field --
   ...

📁 Generating outputs to ./
----------------------------------------
✅ trace_bgym_actions.json (10 actions)
✅ paired_trajectory.json (10 pairs)
✅ context_prompt.txt (for LLM agents)

============================================================
✨ PROCESSING COMPLETE
============================================================
```

## Understanding the Stats

| Stat | Meaning | Good Value |
|------|---------|------------|
| `obs_event_ratio_pct` | % of key events that have an observation | >80% |
| `valid_pair_ratio_pct` | % of pairs where data-bid exists in HTML | >70% |
| `missing_bid_ratio_pct` | % of pairs with missing data-bid | <30% |

**Low valid_pair_ratio?** This means:
- HTML was captured BEFORE the element was rendered
- Element is in an iframe not captured
- Dynamic content appeared after capture

## Output Formats

### `paired_trajectory.json`
```json
{
  "task_id": "...",
  "task_title": "workarena.servicenow.filter-incident-list",
  "stats": {
    "total_raw_events": 50,
    "total_observations": 7,
    "obs_event_ratio_pct": 70.0,
    "valid_pair_ratio_pct": 40.0
  },
  "trajectory": [
    {
      "step": 1,
      "action": {"action": "click", "data_bid": "189"},
      "bid_found_in_html": true,
      "element_info": {"role": "list", "name": "All"},
      "observation": {"timestamp": 123456, "html_length": 250000}
    }
  ]
}
```

### `trace_bgym_actions.json`
```json
{
  "task_id": "...",
  "total_actions": 10,
  "actions": [
    {
      "step": 1,
      "action": "click",
      "data_bid": "189",
      "element_info": {"role": "list", "name": "All"}
    }
  ]
}
```

### `context_prompt.txt`
```
============================================================
HUMAN DEMONSTRATION - IN-CONTEXT LEARNING EXAMPLE
============================================================

## TASK OVERVIEW
Task: workarena.servicenow.filter-incident-list
Starting URL: https://...
Total Steps: 10

## STEP-BY-STEP DEMONSTRATION

### Step 1/10
**Action:** Click on list "All"
**Code:** `click("189")`
...
```

## Other Scripts

| Script | Purpose |
|--------|---------|
| `process_trace.py` | **Main script** - generates all outputs |
| `trace_to_bgym.py` | Actions only (subset of process_trace.py) |
| `pair_obs_action.py` | Pairing only (subset of process_trace.py) |
| `main.py` | MongoDB/S3 pipeline (separate workflow) |

## Dependencies

```bash
uv sync  # Installs from pyproject.toml
```
