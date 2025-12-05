"""
Convert trace.json to BrowserGym Actions Format

This script converts raw extension trace data to BrowserGym-compatible actions.
It filters and combines events to key actions only (no observation pairing).

For observation-action pairing, use pair_obs_action.py instead.
"""

import json
from typing import List, Dict, Any


def combine_and_map_events(event_log: List[Dict]) -> List[Dict]:
    """
    Combines consecutive events on the same BID and filters to key events only.
    Same logic as main.py's combine_and_map_events function.
    """
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
        
        tagName = events[0]["target"].get("tag", "").upper()
        
        if tagName in ["INPUT", "TEXTAREA"]:
            # Combine input events and get final value
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
                
        elif tagName == "SELECT":
            # For select, find the last click event
            for i in range(len(events) - 1, -1, -1):
                if events[i]["type"] == "click":
                    actions.append(events[i])
                    break
        else:
            # For other elements, get last click/submit/pointerdown
            last_event = None
            for i in range(len(events) - 1, -1, -1):
                if events[i]['type'] in ['click', 'submit', 'pointerdown']:
                    last_event = events[i]
                    break
            if last_event:
                actions.append(last_event)
    
    return actions


def event_to_bgym_action(event: Dict) -> Dict[str, Any]:
    """
    Converts a raw event to BrowserGym action format.
    """
    tag = event["target"].get("tag", "").upper()
    bid = event["target"]["bid"]
    
    if tag == "SELECT":
        return {
            "action": "select_option",
            "data_bid": bid,
            "option": event["target"].get("value", ""),
            "timestamp": event["timestamp"]
        }
    elif tag in ["INPUT", "TEXTAREA"]:
        return {
            "action": "fill",
            "data_bid": bid,
            "value": event["target"].get("value", ""),
            "timestamp": event["timestamp"]
        }
    else:
        return {
            "action": "click",
            "data_bid": bid,
            "timestamp": event["timestamp"]
        }


def trace_to_bgym_actions(trace_path: str, output_path: str):
    """
    Converts trace.json to BrowserGym actions format.
    """
    with open(trace_path, 'r', encoding='utf-8') as f:
        trace_data = json.load(f)
    
    # Get events (skip htmlCapture entries)
    event_log = [e for e in trace_data.get('events', []) if e.get('type') != 'htmlCapture']
    
    print(f"Total events before processing: {len(event_log)}")
    
    # Sort by timestamp
    event_log.sort(key=lambda x: x["timestamp"])
    
    # Combine and filter to key events
    key_events = combine_and_map_events(event_log)
    
    print(f"Key events after processing: {len(key_events)}")
    
    # Convert to BrowserGym action format
    bgym_actions = []
    for idx, event in enumerate(key_events):
        action = event_to_bgym_action(event)
        action["step"] = idx + 1
        action["url"] = event.get("url", "")
        action["event_type"] = event["type"]
        
        # Add accessibility info
        a11y = event["target"].get("a11y", {})
        action["element_info"] = {
            "role": a11y.get("role", ""),
            "name": a11y.get("name", ""),
            "tagName": a11y.get("tagName", "")
        }
        
        bgym_actions.append(action)
    
    # Prepare output with metadata
    output_data = {
        "task_id": trace_data.get("id", ""),
        "task_title": trace_data.get("title", ""),
        "start_url": trace_data.get("startUrl", ""),
        "end_url": trace_data.get("endUrl", ""),
        "duration_seconds": trace_data.get("durationSeconds", 0),
        "total_actions": len(bgym_actions),
        "actions": bgym_actions
    }
    
    # Write to output
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2)
    
    print(f"✅ Converted {len(bgym_actions)} actions to {output_path}")
    
    # Print summary
    action_types = {}
    for action in bgym_actions:
        action_type = action["action"]
        action_types[action_type] = action_types.get(action_type, 0) + 1
    
    print("\nAction Summary:")
    for action_type, count in action_types.items():
        print(f"  {action_type}: {count}")


if __name__ == "__main__":
    trace_to_bgym_actions('trace.json', 'trace_bgym_actions.json')
