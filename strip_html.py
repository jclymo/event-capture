#!/usr/bin/env python3
import json
from pathlib import Path

TRACE_PATH = Path("/Users/siddharthsuresh/Downloads/event-capture-archives/2025-11-18T02-20-01-939Z/trace.json")
OUTPUT_PATH = Path("corrected_html.json")

def strip_html(obj):
    if isinstance(obj, dict):
        return {k: strip_html(v) for k, v in obj.items() if k != "html"}
    if isinstance(obj, list):
        return [strip_html(v) for v in obj]
    return obj

def main():
    text = TRACE_PATH.read_text(encoding="utf-8")

    # Try full JSON first, fall back to JSONL if needed
    try:
        data = json.loads(text)
        mode = "json"
    except json.JSONDecodeError:
        lines = [ln for ln in text.splitlines() if ln.strip()]
        data = [json.loads(ln) for ln in lines]
        mode = "jsonl"

    cleaned = strip_html(data)

    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        if mode == "json":
            json.dump(cleaned, f, indent=2)
        else:  # jsonl
            for obj in cleaned:
                json.dump(obj, f)
                f.write("\n")

    print(f"Wrote cleaned file to {OUTPUT_PATH.resolve()}")

if __name__ == "__main__":
    main()
