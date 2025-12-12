"""
Trace Verifier - Validates trace.json structure and integrity

Checks:
- JSON validity and structure
- Required fields presence
- Event schema validation
- Timestamp consistency
- BID (BrowserGym ID) integrity
- HTML capture validation
"""

import json
import os
from typing import Dict, List, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime
import sys

# Add parent for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@dataclass
class VerificationResult:
    """Result of a verification check."""
    name: str
    passed: bool
    message: str
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TraceVerificationReport:
    """Complete trace verification report."""
    trace_path: str
    timestamp: str
    total_checks: int
    passed_checks: int
    failed_checks: int
    warnings: int
    results: List[VerificationResult] = field(default_factory=list)
    summary: Dict[str, Any] = field(default_factory=dict)
    
    @property
    def success_rate(self) -> float:
        return (self.passed_checks / self.total_checks * 100) if self.total_checks > 0 else 0


class TraceVerifier:
    """Verifies trace.json integrity and structure."""
    
    REQUIRED_TOP_LEVEL_FIELDS = ["id", "events", "startUrl"]
    REQUIRED_EVENT_FIELDS = ["type", "timestamp"]
    REQUIRED_TARGET_FIELDS = ["bid", "tag"]
    VALID_EVENT_TYPES = [
        "click", "dblclick", "input", "change", "submit", "focus", "blur",
        "keydown", "keyup", "keypress", "pointerdown", "pointerup",
        "mousedown", "mouseup", "scroll", "htmlCapture", "load", "unload"
    ]
    
    def __init__(self, trace_path: str):
        self.trace_path = trace_path
        self.trace_data = None
        self.results: List[VerificationResult] = []
        self.warnings: List[str] = []
    
    def _add_result(self, name: str, passed: bool, message: str, details: Dict = None):
        """Add a verification result."""
        self.results.append(VerificationResult(
            name=name,
            passed=passed,
            message=message,
            details=details or {}
        ))
    
    def _add_warning(self, warning: str):
        """Add a warning (not a failure)."""
        self.warnings.append(warning)
    
    def verify_file_exists(self) -> bool:
        """Check if trace file exists."""
        exists = os.path.exists(self.trace_path)
        self._add_result(
            "File Exists",
            exists,
            f"Trace file found at {self.trace_path}" if exists else f"Trace file NOT found: {self.trace_path}"
        )
        return exists
    
    def verify_json_valid(self) -> bool:
        """Check if trace is valid JSON."""
        try:
            with open(self.trace_path, 'r', encoding='utf-8') as f:
                self.trace_data = json.load(f)
            self._add_result(
                "Valid JSON",
                True,
                "Trace file is valid JSON"
            )
            return True
        except json.JSONDecodeError as e:
            self._add_result(
                "Valid JSON",
                False,
                f"Invalid JSON: {str(e)}"
            )
            return False
        except Exception as e:
            self._add_result(
                "Valid JSON",
                False,
                f"Error reading file: {str(e)}"
            )
            return False
    
    def verify_top_level_structure(self) -> bool:
        """Verify required top-level fields exist."""
        if not self.trace_data:
            return False
        
        missing = []
        for field in self.REQUIRED_TOP_LEVEL_FIELDS:
            if field not in self.trace_data:
                missing.append(field)
        
        passed = len(missing) == 0
        self._add_result(
            "Top-Level Structure",
            passed,
            "All required fields present" if passed else f"Missing fields: {missing}",
            {"missing_fields": missing, "found_fields": list(self.trace_data.keys())}
        )
        return passed
    
    def verify_events_array(self) -> bool:
        """Verify events is a non-empty array."""
        if not self.trace_data:
            return False
        
        events = self.trace_data.get("events", [])
        is_list = isinstance(events, list)
        is_non_empty = len(events) > 0 if is_list else False
        
        passed = is_list and is_non_empty
        self._add_result(
            "Events Array",
            passed,
            f"Events array contains {len(events)} events" if passed else "Events is not a valid non-empty array",
            {"event_count": len(events) if is_list else 0}
        )
        return passed
    
    def verify_event_schemas(self) -> Tuple[bool, Dict]:
        """Verify each event has required fields and valid structure."""
        if not self.trace_data:
            return False, {}
        
        events = self.trace_data.get("events", [])
        invalid_events = []
        event_type_counts = {}
        events_with_target = 0
        events_without_target = 0
        
        for idx, event in enumerate(events):
            # Count event types
            event_type = event.get("type", "unknown")
            event_type_counts[event_type] = event_type_counts.get(event_type, 0) + 1
            
            # Check required fields
            missing_fields = []
            for field in self.REQUIRED_EVENT_FIELDS:
                if field not in event:
                    missing_fields.append(field)
            
            # Check target for non-htmlCapture events
            if event_type != "htmlCapture":
                if "target" in event:
                    events_with_target += 1
                    target = event["target"]
                    for target_field in self.REQUIRED_TARGET_FIELDS:
                        if target_field not in target:
                            missing_fields.append(f"target.{target_field}")
                else:
                    events_without_target += 1
                    # Some events may not have targets (scroll, etc.)
            
            if missing_fields:
                invalid_events.append({
                    "index": idx,
                    "type": event_type,
                    "missing": missing_fields
                })
        
        # Allow some invalid events (< 10%)
        invalid_ratio = len(invalid_events) / len(events) if events else 0
        passed = invalid_ratio < 0.1
        
        self._add_result(
            "Event Schemas",
            passed,
            f"{len(events) - len(invalid_events)}/{len(events)} events valid" if passed else f"Too many invalid events: {len(invalid_events)}/{len(events)}",
            {
                "total_events": len(events),
                "valid_events": len(events) - len(invalid_events),
                "invalid_events": len(invalid_events),
                "invalid_ratio": round(invalid_ratio * 100, 1),
                "event_type_counts": event_type_counts,
                "events_with_target": events_with_target,
                "sample_invalid": invalid_events[:5]
            }
        )
        return passed, event_type_counts
    
    def verify_timestamps(self) -> bool:
        """Verify timestamps are monotonically increasing (mostly)."""
        if not self.trace_data:
            return False
        
        events = self.trace_data.get("events", [])
        timestamps = [e.get("timestamp", 0) for e in events if "timestamp" in e]
        
        if not timestamps:
            self._add_result(
                "Timestamp Consistency",
                False,
                "No timestamps found in events"
            )
            return False
        
        # Check for out-of-order timestamps
        out_of_order = 0
        max_gap = 0
        prev_ts = timestamps[0]
        
        for ts in timestamps[1:]:
            if ts < prev_ts:
                out_of_order += 1
            gap = ts - prev_ts
            if gap > max_gap:
                max_gap = gap
            prev_ts = ts
        
        total_duration = timestamps[-1] - timestamps[0]
        out_of_order_ratio = out_of_order / len(timestamps) if timestamps else 0
        
        # Allow some out-of-order (< 5%) due to async events
        passed = out_of_order_ratio < 0.05
        
        self._add_result(
            "Timestamp Consistency",
            passed,
            f"Timestamps mostly consistent ({out_of_order} out of order)" if passed else f"Too many out-of-order timestamps: {out_of_order}",
            {
                "total_timestamps": len(timestamps),
                "out_of_order": out_of_order,
                "out_of_order_ratio": round(out_of_order_ratio * 100, 2),
                "duration_ms": total_duration,
                "duration_seconds": round(total_duration / 1000, 2),
                "max_gap_ms": max_gap
            }
        )
        return passed
    
    def verify_bids(self) -> bool:
        """Verify BrowserGym IDs are present and consistent."""
        if not self.trace_data:
            return False
        
        events = self.trace_data.get("events", [])
        events_with_target = [e for e in events if "target" in e and e.get("type") != "htmlCapture"]
        
        bids = []
        missing_bid = 0
        empty_bid = 0
        unique_bids = set()
        
        for event in events_with_target:
            target = event.get("target", {})
            bid = target.get("bid")
            
            if bid is None:
                missing_bid += 1
            elif bid == "":
                empty_bid += 1
            else:
                bids.append(bid)
                unique_bids.add(bid)
        
        total = len(events_with_target)
        valid = total - missing_bid - empty_bid
        valid_ratio = valid / total if total > 0 else 0
        
        passed = valid_ratio > 0.9  # 90% should have valid BIDs
        
        self._add_result(
            "BrowserGym IDs",
            passed,
            f"{valid}/{total} events have valid BIDs ({len(unique_bids)} unique)" if passed else f"Too many events missing BIDs: {missing_bid + empty_bid}/{total}",
            {
                "total_events_with_target": total,
                "valid_bids": valid,
                "missing_bid": missing_bid,
                "empty_bid": empty_bid,
                "unique_bids": len(unique_bids),
                "sample_bids": list(unique_bids)[:10]
            }
        )
        return passed
    
    def verify_html_captures(self) -> bool:
        """Verify HTML capture events."""
        if not self.trace_data:
            return False
        
        events = self.trace_data.get("events", [])
        html_captures = [e for e in events if e.get("type") == "htmlCapture"]
        
        if not html_captures:
            self._add_warning("No HTML captures found in trace")
            self._add_result(
                "HTML Captures",
                True,
                "No HTML captures found (may be expected for some traces)",
                {"html_capture_count": 0}
            )
            return True
        
        valid_captures = 0
        empty_captures = 0
        total_html_size = 0
        
        for capture in html_captures:
            html = capture.get("html", "")
            if html and len(html) > 100:  # Minimum viable HTML
                valid_captures += 1
                total_html_size += len(html)
            elif html == "":
                empty_captures += 1
        
        avg_size = total_html_size / valid_captures if valid_captures > 0 else 0
        valid_ratio = valid_captures / len(html_captures) if html_captures else 0
        
        passed = valid_ratio > 0.8
        
        self._add_result(
            "HTML Captures",
            passed,
            f"{valid_captures}/{len(html_captures)} HTML captures valid (avg {avg_size/1024:.1f}KB)" if passed else f"Too many invalid HTML captures",
            {
                "total_captures": len(html_captures),
                "valid_captures": valid_captures,
                "empty_captures": empty_captures,
                "total_html_size_bytes": total_html_size,
                "avg_size_kb": round(avg_size / 1024, 1)
            }
        )
        return passed
    
    def verify_a11y_data(self) -> bool:
        """Verify accessibility data is present in events."""
        if not self.trace_data:
            return False
        
        events = self.trace_data.get("events", [])
        events_with_target = [e for e in events if "target" in e and e.get("type") != "htmlCapture"]
        
        has_a11y = 0
        has_role = 0
        has_name = 0
        
        for event in events_with_target:
            target = event.get("target", {})
            a11y = target.get("a11y", {})
            
            if a11y:
                has_a11y += 1
                if a11y.get("role"):
                    has_role += 1
                if a11y.get("name"):
                    has_name += 1
        
        total = len(events_with_target)
        a11y_ratio = has_a11y / total if total > 0 else 0
        
        passed = a11y_ratio > 0.5  # At least 50% should have a11y data
        
        self._add_result(
            "Accessibility Data",
            passed,
            f"{has_a11y}/{total} events have a11y data" if passed else f"Insufficient a11y data: {has_a11y}/{total}",
            {
                "total_events": total,
                "has_a11y": has_a11y,
                "has_role": has_role,
                "has_name": has_name,
                "a11y_ratio": round(a11y_ratio * 100, 1)
            }
        )
        return passed
    
    def run_verification(self) -> TraceVerificationReport:
        """Run all verification checks."""
        print(f"\n{'='*60}")
        print("🔍 TRACE VERIFICATION")
        print(f"{'='*60}")
        print(f"Trace: {self.trace_path}")
        
        # Run checks in order (some depend on previous)
        if not self.verify_file_exists():
            return self._build_report()
        
        if not self.verify_json_valid():
            return self._build_report()
        
        self.verify_top_level_structure()
        self.verify_events_array()
        self.verify_event_schemas()
        self.verify_timestamps()
        self.verify_bids()
        self.verify_html_captures()
        self.verify_a11y_data()
        
        return self._build_report()
    
    def _build_report(self) -> TraceVerificationReport:
        """Build final verification report."""
        passed = sum(1 for r in self.results if r.passed)
        failed = sum(1 for r in self.results if not r.passed)
        
        report = TraceVerificationReport(
            trace_path=self.trace_path,
            timestamp=datetime.now().isoformat(),
            total_checks=len(self.results),
            passed_checks=passed,
            failed_checks=failed,
            warnings=len(self.warnings),
            results=self.results,
            summary={
                "trace_valid": failed == 0,
                "success_rate": round(passed / len(self.results) * 100, 1) if self.results else 0,
                "warnings": self.warnings
            }
        )
        
        return report


def print_report(report: TraceVerificationReport):
    """Print verification report."""
    print(f"\n{'─'*60}")
    print("📋 VERIFICATION RESULTS")
    print(f"{'─'*60}")
    
    for result in report.results:
        status = "✅" if result.passed else "❌"
        print(f"  {status} {result.name}: {result.message}")
        if result.details and not result.passed:
            for key, value in list(result.details.items())[:3]:
                print(f"      {key}: {value}")
    
    if report.warnings:
        print(f"\n⚠️  Warnings:")
        for warning in report.warnings:
            print(f"    - {warning}")
    
    print(f"\n{'─'*60}")
    print(f"📊 SUMMARY")
    print(f"{'─'*60}")
    print(f"  Total Checks: {report.total_checks}")
    print(f"  Passed: {report.passed_checks}")
    print(f"  Failed: {report.failed_checks}")
    print(f"  Success Rate: {report.success_rate:.1f}%")
    print(f"  Trace Valid: {'✅ YES' if report.summary['trace_valid'] else '❌ NO'}")
    print(f"{'='*60}\n")


def verify_trace(trace_path: str, save_report: bool = True) -> TraceVerificationReport:
    """Main function to verify a trace file."""
    verifier = TraceVerifier(trace_path)
    report = verifier.run_verification()
    print_report(report)
    
    if save_report:
        report_path = trace_path.replace(".json", "_verification_report.json")
        report_dict = {
            "trace_path": report.trace_path,
            "timestamp": report.timestamp,
            "total_checks": report.total_checks,
            "passed_checks": report.passed_checks,
            "failed_checks": report.failed_checks,
            "warnings": report.warnings,
            "success_rate": report.success_rate,
            "summary": report.summary,
            "results": [
                {
                    "name": r.name,
                    "passed": r.passed,
                    "message": r.message,
                    "details": r.details
                }
                for r in report.results
            ]
        }
        with open(report_path, 'w') as f:
            json.dump(report_dict, f, indent=2)
        print(f"💾 Report saved to: {report_path}")
    
    return report


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Verify trace.json structure and integrity")
    parser.add_argument("trace", nargs="?", help="Path to trace.json")
    parser.add_argument("--no-save", action="store_true", help="Don't save verification report")
    
    args = parser.parse_args()
    
    # Default paths to check
    if args.trace:
        trace_paths = [args.trace]
    else:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(script_dir)
        trace_paths = [
            os.path.join(parent_dir, "post_processing", "form_trace", "trace.json"),
            os.path.join(parent_dir, "post_processing", "trace.json"),
            os.path.join(parent_dir, "trace.json"),
        ]
    
    for path in trace_paths:
        if os.path.exists(path):
            verify_trace(path, save_report=not args.no_save)
            break
    else:
        print(f"❌ No trace.json found. Please specify path.")
        print(f"   Searched: {trace_paths}")

