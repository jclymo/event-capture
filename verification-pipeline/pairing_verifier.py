"""
Pairing Verifier - Validates observation-action pairing

Checks:
- Trajectory structure validity
- Observation-action temporal alignment
- BID presence in HTML snapshots
- Step sequence continuity
- Data completeness
"""

import json
import os
import re
from typing import Dict, List, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@dataclass
class PairingVerificationResult:
    """Result of a pairing verification check."""
    name: str
    passed: bool
    message: str
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PairingVerificationReport:
    """Complete pairing verification report."""
    trajectory_path: str
    timestamp: str
    total_checks: int
    passed_checks: int
    failed_checks: int
    results: List[PairingVerificationResult] = field(default_factory=list)
    summary: Dict[str, Any] = field(default_factory=dict)


class PairingVerifier:
    """Verifies observation-action pairing quality."""
    
    def __init__(self, trajectory_data: Dict):
        self.trajectory_data = trajectory_data
        self.trajectory = trajectory_data.get("trajectory", [])
        self.stats = trajectory_data.get("stats", {})
        self.results: List[PairingVerificationResult] = []
    
    def _add_result(self, name: str, passed: bool, message: str, details: Dict = None):
        """Add a verification result."""
        self.results.append(PairingVerificationResult(
            name=name,
            passed=passed,
            message=message,
            details=details or {}
        ))
    
    def verify_trajectory_present(self) -> bool:
        """Check if trajectory array exists and is non-empty."""
        has_trajectory = len(self.trajectory) > 0
        self._add_result(
            "Trajectory Present",
            has_trajectory,
            f"Found {len(self.trajectory)} trajectory steps" if has_trajectory else "No trajectory found",
            {"step_count": len(self.trajectory)}
        )
        return has_trajectory
    
    def verify_stats_present(self) -> bool:
        """Check if stats are included."""
        has_stats = len(self.stats) > 0
        
        expected_stats = [
            "total_raw_events",
            "total_observations",
            "total_key_events",
            "total_pairs",
            "valid_pairs"
        ]
        
        found_stats = [s for s in expected_stats if s in self.stats]
        missing_stats = [s for s in expected_stats if s not in self.stats]
        
        passed = len(found_stats) >= 3
        
        self._add_result(
            "Stats Present",
            passed,
            f"Found {len(found_stats)}/{len(expected_stats)} expected stats" if passed else f"Missing stats: {missing_stats}",
            {
                "found_stats": found_stats,
                "missing_stats": missing_stats,
                "stats": self.stats
            }
        )
        return passed
    
    def verify_step_structure(self) -> bool:
        """Verify each step has required fields."""
        required_fields = ["step", "action", "observation"]
        optional_fields = ["bid_found_in_html", "element_info", "event_type"]
        
        invalid_steps = []
        
        for idx, step in enumerate(self.trajectory):
            missing = []
            for field in required_fields:
                if field not in step:
                    missing.append(field)
            
            if missing:
                invalid_steps.append({
                    "step_index": idx,
                    "step_number": step.get("step", idx),
                    "missing_fields": missing
                })
        
        passed = len(invalid_steps) == 0
        
        self._add_result(
            "Step Structure",
            passed,
            f"All {len(self.trajectory)} steps have required fields" if passed else f"{len(invalid_steps)} steps missing fields",
            {
                "total_steps": len(self.trajectory),
                "valid_steps": len(self.trajectory) - len(invalid_steps),
                "invalid_steps": invalid_steps[:5]
            }
        )
        return passed
    
    def verify_action_format(self) -> bool:
        """Verify action format in each step."""
        action_fields = ["action", "data_bid"]
        invalid_actions = []
        action_types = {}
        
        for idx, step in enumerate(self.trajectory):
            action = step.get("action", {})
            step_num = step.get("step", idx)
            
            # Check action type
            action_type = action.get("action", "unknown")
            action_types[action_type] = action_types.get(action_type, 0) + 1
            
            # Check for required action fields
            missing = []
            for field in action_fields:
                if field not in action:
                    missing.append(field)
            
            if missing:
                invalid_actions.append({
                    "step": step_num,
                    "missing": missing
                })
        
        passed = len(invalid_actions) == 0
        
        self._add_result(
            "Action Format",
            passed,
            f"All actions have valid format" if passed else f"{len(invalid_actions)} actions have invalid format",
            {
                "action_types": action_types,
                "invalid_actions": invalid_actions[:5]
            }
        )
        return passed
    
    def verify_observation_format(self) -> bool:
        """Verify observation format in each step."""
        observation_fields = ["timestamp", "url"]
        invalid_observations = []
        
        for idx, step in enumerate(self.trajectory):
            obs = step.get("observation", {})
            step_num = step.get("step", idx)
            
            missing = []
            for field in observation_fields:
                if field not in obs:
                    missing.append(field)
            
            if missing:
                invalid_observations.append({
                    "step": step_num,
                    "missing": missing
                })
        
        passed = len(invalid_observations) == 0
        
        self._add_result(
            "Observation Format",
            passed,
            f"All observations have valid format" if passed else f"{len(invalid_observations)} observations have invalid format",
            {
                "total_observations": len(self.trajectory),
                "invalid_observations": invalid_observations[:5]
            }
        )
        return passed
    
    def verify_bid_html_presence(self) -> bool:
        """Verify BID presence in HTML (if tracked)."""
        bid_found_count = 0
        bid_missing_count = 0
        not_tracked_count = 0
        
        for step in self.trajectory:
            bid_found = step.get("bid_found_in_html")
            if bid_found is True:
                bid_found_count += 1
            elif bid_found is False:
                bid_missing_count += 1
            else:
                not_tracked_count += 1
        
        total_tracked = bid_found_count + bid_missing_count
        
        if total_tracked == 0:
            self._add_result(
                "BID-HTML Presence",
                True,
                "BID presence not tracked in this trajectory",
                {"not_tracked_count": not_tracked_count}
            )
            return True
        
        valid_ratio = bid_found_count / total_tracked if total_tracked > 0 else 0
        passed = valid_ratio >= 0.5  # At least 50% should have valid BIDs
        
        self._add_result(
            "BID-HTML Presence",
            passed,
            f"{bid_found_count}/{total_tracked} ({valid_ratio*100:.0f}%) actions have BID in HTML" if passed else f"Low BID-HTML match: {valid_ratio*100:.0f}%",
            {
                "bid_found_count": bid_found_count,
                "bid_missing_count": bid_missing_count,
                "not_tracked_count": not_tracked_count,
                "valid_ratio": round(valid_ratio * 100, 1)
            }
        )
        return passed
    
    def verify_step_sequence(self) -> bool:
        """Verify steps are sequential."""
        if not self.trajectory:
            return True
        
        steps = [s.get("step", idx) for idx, s in enumerate(self.trajectory)]
        expected_steps = list(range(1, len(self.trajectory) + 1))
        
        gaps = []
        duplicates = []
        seen = set()
        
        for step in steps:
            if step in seen:
                duplicates.append(step)
            seen.add(step)
        
        for expected in expected_steps:
            if expected not in seen:
                gaps.append(expected)
        
        passed = len(gaps) == 0 and len(duplicates) == 0
        
        self._add_result(
            "Step Sequence",
            passed,
            f"Steps 1-{len(self.trajectory)} are sequential" if passed else f"Sequence issues: {len(gaps)} gaps, {len(duplicates)} duplicates",
            {
                "expected_steps": len(expected_steps),
                "gaps": gaps[:5],
                "duplicates": duplicates[:5]
            }
        )
        return passed
    
    def verify_temporal_alignment(self) -> bool:
        """Verify observation timestamps precede action timestamps."""
        misaligned = []
        
        for step in self.trajectory:
            obs = step.get("observation", {})
            obs_ts = obs.get("timestamp", 0)
            event_ts = step.get("event_timestamp", 0)
            step_num = step.get("step", 0)
            
            if obs_ts > event_ts and event_ts > 0:
                misaligned.append({
                    "step": step_num,
                    "obs_ts": obs_ts,
                    "event_ts": event_ts,
                    "diff_ms": obs_ts - event_ts
                })
        
        passed = len(misaligned) < len(self.trajectory) * 0.1  # Allow 10% misalignment
        
        self._add_result(
            "Temporal Alignment",
            passed,
            f"Observation-action temporal alignment OK" if passed else f"{len(misaligned)} misaligned pairs",
            {
                "total_pairs": len(self.trajectory),
                "misaligned": len(misaligned),
                "misaligned_samples": misaligned[:5]
            }
        )
        return passed
    
    def verify_element_info_quality(self) -> bool:
        """Verify element info quality."""
        with_role = 0
        with_name = 0
        with_tag = 0
        total = len(self.trajectory)
        
        for step in self.trajectory:
            elem_info = step.get("element_info", {})
            if elem_info.get("role"):
                with_role += 1
            if elem_info.get("name"):
                with_name += 1
            if elem_info.get("tagName"):
                with_tag += 1
        
        # At least 50% should have some element info
        quality_score = (with_role + with_name + with_tag) / (total * 3) if total > 0 else 0
        passed = quality_score >= 0.3
        
        self._add_result(
            "Element Info Quality",
            passed,
            f"Element info quality: {quality_score*100:.0f}%" if passed else f"Low element info quality: {quality_score*100:.0f}%",
            {
                "total_steps": total,
                "with_role": with_role,
                "with_name": with_name,
                "with_tag": with_tag,
                "quality_score": round(quality_score * 100, 1)
            }
        )
        return passed
    
    def verify_stats_consistency(self) -> bool:
        """Verify stats are consistent with trajectory."""
        if not self.stats:
            self._add_result(
                "Stats Consistency",
                True,
                "No stats to verify",
                {}
            )
            return True
        
        issues = []
        
        # Check total_pairs matches trajectory length
        total_pairs = self.stats.get("total_pairs", len(self.trajectory))
        if total_pairs != len(self.trajectory):
            issues.append(f"total_pairs ({total_pairs}) != trajectory length ({len(self.trajectory)})")
        
        # Check valid_pairs is <= total_pairs
        valid_pairs = self.stats.get("valid_pairs", 0)
        if valid_pairs > total_pairs:
            issues.append(f"valid_pairs ({valid_pairs}) > total_pairs ({total_pairs})")
        
        passed = len(issues) == 0
        
        self._add_result(
            "Stats Consistency",
            passed,
            "Stats consistent with trajectory" if passed else f"Inconsistencies: {issues}",
            {
                "trajectory_length": len(self.trajectory),
                "stats_total_pairs": total_pairs,
                "stats_valid_pairs": valid_pairs,
                "issues": issues
            }
        )
        return passed
    
    def run_verification(self) -> PairingVerificationReport:
        """Run all verification checks."""
        print(f"\n{'='*60}")
        print("🔗 PAIRING VERIFICATION")
        print(f"{'='*60}")
        
        self.verify_trajectory_present()
        self.verify_stats_present()
        self.verify_step_structure()
        self.verify_action_format()
        self.verify_observation_format()
        self.verify_bid_html_presence()
        self.verify_step_sequence()
        self.verify_temporal_alignment()
        self.verify_element_info_quality()
        self.verify_stats_consistency()
        
        passed = sum(1 for r in self.results if r.passed)
        failed = sum(1 for r in self.results if not r.passed)
        
        return PairingVerificationReport(
            trajectory_path="",
            timestamp=datetime.now().isoformat(),
            total_checks=len(self.results),
            passed_checks=passed,
            failed_checks=failed,
            results=self.results,
            summary={
                "pairing_valid": failed == 0,
                "success_rate": round(passed / len(self.results) * 100, 1) if self.results else 0,
                "total_pairs": len(self.trajectory)
            }
        )


def print_report(report: PairingVerificationReport):
    """Print verification report."""
    print(f"\n{'─'*60}")
    print("📋 PAIRING VERIFICATION RESULTS")
    print(f"{'─'*60}")
    
    for result in report.results:
        status = "✅" if result.passed else "❌"
        print(f"  {status} {result.name}: {result.message}")
    
    print(f"\n{'─'*60}")
    print(f"📊 SUMMARY")
    print(f"{'─'*60}")
    print(f"  Total Checks: {report.total_checks}")
    print(f"  Passed: {report.passed_checks}")
    print(f"  Failed: {report.failed_checks}")
    print(f"  Success Rate: {report.summary.get('success_rate', 0):.1f}%")
    print(f"  Pairing Valid: {'✅ YES' if report.summary['pairing_valid'] else '❌ NO'}")
    print(f"{'='*60}\n")


def verify_pairing(trajectory_path: str = None, trajectory_data: Dict = None, save_report: bool = True) -> PairingVerificationReport:
    """Main function to verify pairing."""
    if trajectory_data is None:
        if trajectory_path is None:
            raise ValueError("Must provide either trajectory_path or trajectory_data")
        with open(trajectory_path, 'r', encoding='utf-8') as f:
            trajectory_data = json.load(f)
    
    verifier = PairingVerifier(trajectory_data)
    report = verifier.run_verification()
    report.trajectory_path = trajectory_path or "in-memory"
    
    print_report(report)
    
    if save_report and trajectory_path:
        report_path = trajectory_path.replace(".json", "_pairing_verification.json")
        report_dict = {
            "trajectory_path": report.trajectory_path,
            "timestamp": report.timestamp,
            "total_checks": report.total_checks,
            "passed_checks": report.passed_checks,
            "failed_checks": report.failed_checks,
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
    
    parser = argparse.ArgumentParser(description="Verify observation-action pairing")
    parser.add_argument("trajectory", nargs="?", help="Path to paired_trajectory.json")
    parser.add_argument("--no-save", action="store_true", help="Don't save verification report")
    
    args = parser.parse_args()
    
    # Default paths to check
    if args.trajectory:
        trajectory_paths = [args.trajectory]
    else:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(script_dir)
        trajectory_paths = [
            os.path.join(parent_dir, "post_processing", "paired_trajectory.json"),
        ]
    
    for path in trajectory_paths:
        if os.path.exists(path):
            print(f"📂 Loading trajectory from: {path}")
            verify_pairing(path, save_report=not args.no_save)
            break
    else:
        print(f"❌ No trajectory file found. Please specify path.")
        print(f"   Searched: {trajectory_paths}")

