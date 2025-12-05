"""
Process Trace - Complete Pipeline

Single script that processes trace.json and generates all outputs:
1. BrowserGym actions (trace_bgym_actions.json)
2. Paired trajectory with stats (paired_trajectory.json)
3. HTML snapshots (optional, to html_snapshots/)
4. Context prompt for LLM agents (context_prompt.txt)

Usage:
    uv run python process_trace.py trace.json
    uv run python process_trace.py trace.json --extract-html
    uv run python process_trace.py trace.json -o output_folder/
"""

import json
import os
import argparse
from typing import List, Dict, Tuple, Any
from bs4 import BeautifulSoup


# ============================================================
# CORE FUNCTIONS
# ============================================================

def split_observation_and_event_logs(full_log: List[Dict]) -> Tuple[List[Dict], List[Dict]]:
    """Separate HTML captures (observations) from regular events."""
    html_log, event_log = [], []
    for entry in full_log:
        if entry['type'] == 'htmlCapture':
            html_log.append(entry)
        else:
            event_log.append(entry)
    return html_log, event_log


def combine_and_map_events(event_log: List[Dict]) -> List[Dict]:
    """Combines consecutive events on same BID, filters to key events."""
    prev_bids = []
    bid_events = {}
    bid_history = []
    
    for event in event_log:
        bid = event["target"]["bid"]
        if bid not in bid_history:
            bid_history.append(bid)
        if bid not in prev_bids:
            prev_bids.append(bid)
            bid_events[bid] = [event]
        else:
            bid_events[bid].append(event)
        
        if len(prev_bids) > 2:
            prev_bids.pop(0)
    
    actions = []
    for bid in bid_history:
        events = bid_events.get(bid)
        if events is None:
            continue
        
        tagName = events[0]["target"].get("tag", "").lower()
        
        if tagName in ["input", "textarea"]:
            data = ""
            last_event = None
            for e in events:
                if e['type'] == 'input':
                    last_event = e
                    data += e.get('data', '')
            if data == "":
                continue
            if last_event:
                last_event["data"] = data
                actions.append(last_event)
                
        elif tagName == "select":
            for i in range(len(events) - 1, -1, -1):
                if events[i]["type"] == "click":
                    actions.append(events[i])
                    break
        else:
            last_event = None
            for i in range(len(events) - 1, -1, -1):
                if events[i]['type'] in ['click', 'submit', 'pointerdown']:
                    last_event = events[i]
                    break
            if last_event:
                actions.append(last_event)
    
    return actions


def pair_closest_before(events: List[Dict], observations: List[Dict]) -> List[Tuple[Dict, Dict]]:
    """For each event, find the closest preceding observation."""
    ans = []
    j = 0
    for event in events:
        while j + 1 < len(observations) and observations[j + 1]["timestamp"] < event["timestamp"]:
            j += 1
        if j < len(observations):
            ans.append((observations[j], event))
    return ans


def check_bid_in_html(html: str, data_bid: str) -> bool:
    """Check if data-bid exists in HTML observation."""
    try:
        soup = BeautifulSoup(html, "html.parser")
        elem = soup.find(attrs={"data-bid": data_bid})
        return elem is not None
    except:
        return False


def event_to_bgym_action(event: Dict) -> Dict[str, Any]:
    """Converts a raw event to BrowserGym action format."""
    tag = event["target"].get("tag", "").upper()
    bid = event["target"]["bid"]
    
    if tag == "SELECT":
        return {"action": "select_option", "data_bid": bid, "option": event["target"].get("value", "")}
    elif tag in ["INPUT", "TEXTAREA"]:
        return {"action": "fill", "data_bid": bid, "value": event["target"].get("value", "")}
    else:
        return {"action": "click", "data_bid": bid}


# ============================================================
# OUTPUT GENERATORS
# ============================================================

def generate_bgym_actions(key_events: List[Dict], trace_data: Dict) -> Dict:
    """Generate BrowserGym actions JSON."""
    bgym_actions = []
    for idx, event in enumerate(key_events):
        action = event_to_bgym_action(event)
        action["step"] = idx + 1
        action["timestamp"] = event["timestamp"]
        action["url"] = event.get("url", "")
        action["event_type"] = event["type"]
        
        a11y = event["target"].get("a11y", {})
        action["element_info"] = {
            "role": a11y.get("role", ""),
            "name": a11y.get("name", ""),
            "tagName": event["target"].get("tag", "")
        }
        bgym_actions.append(action)
    
    return {
        "task_id": trace_data.get("id", ""),
        "task_title": trace_data.get("title", ""),
        "start_url": trace_data.get("startUrl", ""),
        "end_url": trace_data.get("endUrl", ""),
        "duration_seconds": trace_data.get("durationSeconds", 0),
        "total_actions": len(bgym_actions),
        "actions": bgym_actions
    }


def generate_paired_trajectory(pairs: List[Tuple], trace_data: Dict, stats: Dict) -> Dict:
    """Generate paired trajectory JSON."""
    trajectory = []
    for idx, (obs, event) in enumerate(pairs):
        action = event_to_bgym_action(event)
        data_bid = event["target"]["bid"]
        html_content = obs.get("html", "")
        bid_found = check_bid_in_html(html_content, data_bid)
        
        a11y = event["target"].get("a11y", {})
        
        step_data = {
            "step": idx + 1,
            "action": action,
            "bid_found_in_html": bid_found,
            "element_info": {
                "role": a11y.get("role", ""),
                "name": a11y.get("name", ""),
                "tagName": event["target"].get("tag", "")
            },
            "event_type": event["type"],
            "event_timestamp": event["timestamp"],
            "observation": {
                "timestamp": obs["timestamp"],
                "url": obs.get("url", ""),
                "video_timestamp": obs.get("video_timestamp", 0),
                "html_length": len(html_content)
            }
        }
        trajectory.append(step_data)
    
    return {
        "task_id": trace_data.get("id", ""),
        "task_title": trace_data.get("title", ""),
        "start_url": trace_data.get("startUrl", ""),
        "end_url": trace_data.get("endUrl", ""),
        "duration_seconds": trace_data.get("durationSeconds", 0),
        "stats": stats,
        "trajectory": trajectory
    }


def generate_context_prompt(bgym_data: Dict) -> str:
    """Generate in-context learning prompt for LLM agents."""
    actions = bgym_data.get("actions", [])
    task_title = bgym_data.get("task_title", "Unknown Task")
    start_url = bgym_data.get("start_url", "")
    
    lines = [
        "=" * 60,
        "HUMAN DEMONSTRATION - IN-CONTEXT LEARNING EXAMPLE",
        "=" * 60,
        "",
        "## TASK OVERVIEW",
        f"Task: {task_title}",
        f"Starting URL: {start_url}",
        f"Total Steps: {len(actions)}",
        "",
        "## STEP-BY-STEP DEMONSTRATION",
        ""
    ]
    
    for action in actions:
        step = action["step"]
        action_type = action["action"]
        bid = action["data_bid"]
        elem = action.get("element_info", {})
        role = elem.get("role", "")
        name = elem.get("name", "")
        
        # Format action description
        if action_type == "click":
            desc = f'Click on {role} "{name}"' if name else f"Click on {role} (bid={bid})"
            code = f'click("{bid}")'
        elif action_type == "fill":
            value = action.get("value", "")
            desc = f'Type "{value}" into {role} "{name}"' if name else f'Type "{value}" (bid={bid})'
            code = f'fill("{bid}", "{value}")'
        elif action_type == "select_option":
            option = action.get("option", "")
            desc = f'Select "{option}" from {role} "{name}"' if name else f'Select "{option}" (bid={bid})'
            code = f'select_option("{bid}", "{option}")'
        else:
            desc = f"{action_type} on {role} (bid={bid})"
            code = f'{action_type}("{bid}")'
        
        lines.extend([
            f"### Step {step}/{len(actions)}",
            f"**Action:** {desc}",
            f"**Code:** `{code}`",
            ""
        ])
    
    lines.extend([
        "## KEY PATTERNS",
        "- Identify elements by their role and name",
        "- Follow the same sequence of interactions",
        "- Adapt values based on current task requirements",
        "",
        "=" * 60
    ])
    
    return "\n".join(lines)


def extract_html_snapshots(html_log: List[Dict], output_dir: str) -> List[Dict]:
    """Extract HTML snapshots to separate files."""
    os.makedirs(output_dir, exist_ok=True)
    
    file_refs = []
    for idx, obs in enumerate(html_log):
        filename = f"snapshot_{idx:03d}_{obs['timestamp']}.html"
        filepath = os.path.join(output_dir, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(obs.get("html", ""))
        
        file_refs.append({
            "index": idx,
            "filename": filename,
            "timestamp": obs["timestamp"],
            "url": obs.get("url", "")
        })
    
    return file_refs


# ============================================================
# MAIN PIPELINE
# ============================================================

def process_trace(trace_path: str, output_dir: str = ".", extract_html: bool = False):
    """
    Complete processing pipeline for trace.json.
    
    Generates:
    - trace_bgym_actions.json
    - paired_trajectory.json
    - context_prompt.txt
    - html_snapshots/ (if --extract-html)
    """
    print("\n" + "=" * 60)
    print("🚀 TRACE PROCESSING PIPELINE")
    print("=" * 60)
    
    # Load trace data
    print(f"\n📂 Loading {trace_path}...")
    with open(trace_path, 'r', encoding='utf-8') as f:
        trace_data = json.load(f)
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Split observations and events
    html_log, event_log = split_observation_and_event_logs(trace_data.get('events', []))
    html_log.sort(key=lambda x: x["timestamp"])
    event_log.sort(key=lambda x: x["timestamp"])
    
    # Combine to key events
    key_events = combine_and_map_events(event_log)
    
    # Pair observations with events
    pairs = pair_closest_before(key_events, html_log)
    
    # ========== CALCULATE STATS ==========
    total_raw_events = len(event_log)
    total_observations = len(html_log)
    total_key_events = len(key_events)
    total_pairs = len(pairs)
    
    valid_pairs = 0
    missing_bid_details = []
    
    for idx, (obs, event) in enumerate(pairs):
        data_bid = event["target"]["bid"]
        html_content = obs.get("html", "")
        
        if check_bid_in_html(html_content, data_bid):
            valid_pairs += 1
        else:
            missing_bid_details.append({
                "step": idx + 1,
                "data_bid": data_bid,
                "event_type": event["type"],
                "element": event["target"].get("a11y", {}).get("name", "unknown")
            })
    
    obs_event_ratio = (total_observations / total_key_events * 100) if total_key_events > 0 else 0
    valid_pair_ratio = (valid_pairs / total_pairs * 100) if total_pairs > 0 else 0
    missing_bid_ratio = 100 - valid_pair_ratio
    
    stats = {
        "total_raw_events": total_raw_events,
        "total_observations": total_observations,
        "total_key_events": total_key_events,
        "total_pairs": total_pairs,
        "valid_pairs": valid_pairs,
        "obs_event_ratio_pct": round(obs_event_ratio, 1),
        "valid_pair_ratio_pct": round(valid_pair_ratio, 1),
        "missing_bid_ratio_pct": round(missing_bid_ratio, 1)
    }
    
    # ========== PRINT STATS ==========
    print(f"\n📊 DIAGNOSTIC STATISTICS")
    print("-" * 40)
    print(f"📝 Raw events: {total_raw_events}")
    print(f"📸 HTML observations: {total_observations}")
    print(f"🔑 Key events (filtered): {total_key_events}")
    print(f"🔗 Pairs created: {total_pairs}")
    print()
    print(f"📈 {obs_event_ratio:.0f}% => observation:event ratio")
    print(f"   We collected {total_key_events} events, but only have {total_observations} observations")
    print()
    print(f"✅ {valid_pair_ratio:.0f}% => event-observation pairs with valid data-bid")
    print(f"❌ {missing_bid_ratio:.0f}% => data-bid missing in observations")
    
    if missing_bid_details:
        print(f"\n⚠️  Missing BID Details (first 5):")
        for item in missing_bid_details[:5]:
            print(f"   Step {item['step']}: bid={item['data_bid']}, type={item['event_type']}, element={item['element']}")
    
    # ========== GENERATE OUTPUTS ==========
    print(f"\n📁 Generating outputs to {output_dir}/")
    print("-" * 40)
    
    # 1. BrowserGym Actions
    bgym_data = generate_bgym_actions(key_events, trace_data)
    bgym_path = os.path.join(output_dir, "trace_bgym_actions.json")
    with open(bgym_path, 'w', encoding='utf-8') as f:
        json.dump(bgym_data, f, indent=2)
    print(f"✅ trace_bgym_actions.json ({len(bgym_data['actions'])} actions)")
    
    # 2. Paired Trajectory
    paired_data = generate_paired_trajectory(pairs, trace_data, stats)
    paired_path = os.path.join(output_dir, "paired_trajectory.json")
    with open(paired_path, 'w', encoding='utf-8') as f:
        json.dump(paired_data, f, indent=2)
    print(f"✅ paired_trajectory.json ({len(paired_data['trajectory'])} pairs)")
    
    # 3. Context Prompt
    prompt = generate_context_prompt(bgym_data)
    prompt_path = os.path.join(output_dir, "context_prompt.txt")
    with open(prompt_path, 'w', encoding='utf-8') as f:
        f.write(prompt)
    print(f"✅ context_prompt.txt (for LLM agents)")
    
    # 4. HTML Snapshots (optional)
    if extract_html:
        html_dir = os.path.join(output_dir, "html_snapshots")
        file_refs = extract_html_snapshots(html_log, html_dir)
        print(f"✅ html_snapshots/ ({len(file_refs)} files)")
    
    # ========== SUMMARY ==========
    print("\n" + "=" * 60)
    print("✨ PROCESSING COMPLETE")
    print("=" * 60)
    print(f"\nOutput files in: {os.path.abspath(output_dir)}/")
    print(f"  - trace_bgym_actions.json  (actions only)")
    print(f"  - paired_trajectory.json   (obs + actions + stats)")
    print(f"  - context_prompt.txt       (for LLM in-context learning)")
    if extract_html:
        print(f"  - html_snapshots/          ({len(html_log)} HTML files)")
    
    return {
        "bgym_actions": bgym_data,
        "paired_trajectory": paired_data,
        "stats": stats
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Process trace.json - Complete pipeline for all outputs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  uv run python process_trace.py trace.json
  uv run python process_trace.py trace.json -o results/
  uv run python process_trace.py trace.json --extract-html
  uv run python process_trace.py path/to/trace.json -o output/ --extract-html
        """
    )
    parser.add_argument("trace", help="Path to trace.json file")
    parser.add_argument("-o", "--output", default=".", help="Output directory (default: current)")
    parser.add_argument("--extract-html", action="store_true", help="Extract HTML snapshots to files")
    
    args = parser.parse_args()
    process_trace(args.trace, args.output, args.extract_html)

