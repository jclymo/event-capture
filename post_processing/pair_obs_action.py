"""
Pair Observations with Actions from trace.json

This script:
1. Splits HTML captures (observations) from regular events
2. Combines and filters events to key actions (like main.py)
3. Pairs each action with the closest preceding HTML observation
4. Outputs paired data for training with diagnostic stats
"""

import json
from typing import List, Dict, Tuple, Any
from bs4 import BeautifulSoup


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


def pair_obs_actions(trace_path: str, output_path: str, include_html: bool = False):
    """
    Main function to pair observations with actions.
    
    Args:
        trace_path: Path to trace.json
        output_path: Path for output JSON
        include_html: Whether to include full HTML content (large!)
    """
    with open(trace_path, 'r', encoding='utf-8') as f:
        trace_data = json.load(f)
    
    # Split HTML observations from events
    html_log, event_log = split_observation_and_event_logs(trace_data.get('events', []))
    
    # Sort by timestamp
    html_log.sort(key=lambda x: x["timestamp"])
    event_log.sort(key=lambda x: x["timestamp"])
    
    # Combine and filter to key events
    key_events = combine_and_map_events(event_log)
    
    # Pair each event with closest preceding observation
    pairs = pair_closest_before(key_events, html_log)
    
    # ========== DIAGNOSTIC STATS ==========
    total_raw_events = len(event_log)
    total_observations = len(html_log)
    total_key_events = len(key_events)
    total_pairs = len(pairs)
    
    # Check how many pairs have valid data-bid in HTML
    valid_pairs = 0
    missing_bid_pairs = []
    
    for idx, (obs, event) in enumerate(pairs):
        data_bid = event["target"]["bid"]
        html_content = obs.get("html", "")
        
        if check_bid_in_html(html_content, data_bid):
            valid_pairs += 1
        else:
            missing_bid_pairs.append({
                "step": idx + 1,
                "data_bid": data_bid,
                "event_type": event["type"],
                "element": event["target"].get("a11y", {}).get("name", "unknown")
            })
    
    # Calculate ratios
    obs_event_ratio = (total_observations / total_key_events * 100) if total_key_events > 0 else 0
    valid_pair_ratio = (valid_pairs / total_pairs * 100) if total_pairs > 0 else 0
    missing_bid_ratio = 100 - valid_pair_ratio
    
    # ========== PRINT STATS ==========
    print("\n" + "=" * 60)
    print("📊 DIAGNOSTIC STATISTICS")
    print("=" * 60)
    
    print(f"\n📝 Raw Data:")
    print(f"   Total raw events: {total_raw_events}")
    print(f"   Total HTML observations: {total_observations}")
    print(f"   Key events (filtered): {total_key_events}")
    
    print(f"\n📈 Observation:Event Ratio:")
    print(f"   {obs_event_ratio:.0f}% => observation:event ratio")
    print(f"   We collected {total_key_events} events, but only have {total_observations} observations")
    
    print(f"\n🔗 Pairing Results:")
    print(f"   Total pairs created: {total_pairs}")
    print(f"   Valid pairs (BID found in HTML): {valid_pairs}")
    print(f"   Invalid pairs (BID missing): {total_pairs - valid_pairs}")
    
    print(f"\n✅ Valid Pair Ratio:")
    print(f"   {valid_pair_ratio:.0f}% => event-observation pairs with valid data-bid")
    print(f"   data-bid were missing in {missing_bid_ratio:.0f}% of observations")
    
    if missing_bid_pairs:
        print(f"\n⚠️  Missing BID Details (first 5):")
        for item in missing_bid_pairs[:5]:
            print(f"   Step {item['step']}: bid={item['data_bid']}, type={item['event_type']}, element={item['element']}")
    
    print("\n" + "=" * 60)
    
    # ========== BUILD OUTPUT ==========
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
                "video_timestamp": obs.get("video_timestamp", 0)
            }
        }
        
        if include_html:
            step_data["observation"]["html"] = html_content
        else:
            step_data["observation"]["html_length"] = len(html_content)
        
        trajectory.append(step_data)
    
    # Output with stats
    output_data = {
        "task_id": trace_data.get("id", ""),
        "task_title": trace_data.get("title", ""),
        "start_url": trace_data.get("startUrl", ""),
        "end_url": trace_data.get("endUrl", ""),
        "duration_seconds": trace_data.get("durationSeconds", 0),
        "stats": {
            "total_raw_events": total_raw_events,
            "total_observations": total_observations,
            "total_key_events": total_key_events,
            "total_pairs": total_pairs,
            "valid_pairs": valid_pairs,
            "obs_event_ratio_pct": round(obs_event_ratio, 1),
            "valid_pair_ratio_pct": round(valid_pair_ratio, 1),
            "missing_bid_ratio_pct": round(missing_bid_ratio, 1)
        },
        "trajectory": trajectory
    }
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2)
    
    print(f"\n✅ Saved {len(trajectory)} pairs to {output_path}")
    
    return output_data


def extract_html_files(trace_path: str, output_dir: str = "html_snapshots"):
    """
    Extract all HTML observations to separate files.
    Useful when you don't want to include HTML inline in the JSON.
    """
    import os
    
    with open(trace_path, 'r', encoding='utf-8') as f:
        trace_data = json.load(f)
    
    html_log, _ = split_observation_and_event_logs(trace_data.get('events', []))
    html_log.sort(key=lambda x: x["timestamp"])
    
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
    
    print(f"✅ Extracted {len(html_log)} HTML snapshots to {output_dir}/")
    return file_refs


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Pair observations with actions from trace.json")
    parser.add_argument("trace", nargs="?", default="trace.json", help="Path to trace.json")
    parser.add_argument("-o", "--output", default="paired_trajectory.json", help="Output path")
    parser.add_argument("--include-html", action="store_true", help="Include full HTML content")
    parser.add_argument("--extract-html", action="store_true", help="Extract HTML to separate files")
    parser.add_argument("--html-dir", default="html_snapshots", help="Directory for extracted HTML")
    
    args = parser.parse_args()
    
    if args.extract_html:
        extract_html_files(args.trace, args.html_dir)
    
    pair_obs_actions(args.trace, args.output, include_html=args.include_html)

