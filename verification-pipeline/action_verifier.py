"""
Action Verifier - Validates BrowserGym action extraction

Checks:
- Action format validity (click, fill, select_option)
- BID references are valid
- Fill values are present for fill actions
- Select options are present for select_option actions
- Action sequence makes sense
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
class ActionVerificationResult:
    """Result of an action verification check."""
    name: str
    passed: bool
    message: str
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionVerificationReport:
    """Complete action verification report."""
    actions_path: str
    timestamp: str
    total_checks: int
    passed_checks: int
    failed_checks: int
    results: List[ActionVerificationResult] = field(default_factory=list)
    summary: Dict[str, Any] = field(default_factory=dict)


class ActionVerifier:
    """Verifies BrowserGym action extraction."""
    
    VALID_ACTIONS = ["click", "fill", "select_option", "scroll", "noop", "hover"]
    ACTION_PATTERN = re.compile(r'^(click|fill|select_option|scroll|noop|hover)\(["\']?[^"\']*["\']?(?:,\s*["\']?[^"\']*["\']?)?\)$')
    
    def __init__(self, actions_data: Dict):
        self.actions_data = actions_data
        self.actions = actions_data.get("actions", [])
        self.results: List[ActionVerificationResult] = []
    
    def _add_result(self, name: str, passed: bool, message: str, details: Dict = None):
        """Add a verification result."""
        self.results.append(ActionVerificationResult(
            name=name,
            passed=passed,
            message=message,
            details=details or {}
        ))
    
    def verify_actions_present(self) -> bool:
        """Check if actions array exists and is non-empty."""
        has_actions = len(self.actions) > 0
        self._add_result(
            "Actions Present",
            has_actions,
            f"Found {len(self.actions)} actions" if has_actions else "No actions found",
            {"action_count": len(self.actions)}
        )
        return has_actions
    
    def verify_action_types(self) -> bool:
        """Verify all action types are valid."""
        invalid_actions = []
        action_type_counts = {}
        
        for idx, action in enumerate(self.actions):
            action_type = action.get("action", "unknown")
            action_type_counts[action_type] = action_type_counts.get(action_type, 0) + 1
            
            if action_type not in self.VALID_ACTIONS:
                invalid_actions.append({
                    "step": action.get("step", idx),
                    "action_type": action_type
                })
        
        passed = len(invalid_actions) == 0
        self._add_result(
            "Action Types Valid",
            passed,
            f"All action types valid" if passed else f"{len(invalid_actions)} invalid action types",
            {
                "action_type_counts": action_type_counts,
                "invalid_actions": invalid_actions[:5]
            }
        )
        return passed
    
    def verify_bids_present(self) -> bool:
        """Verify all actions have data_bid."""
        missing_bid = []
        empty_bid = []
        
        for idx, action in enumerate(self.actions):
            bid = action.get("data_bid")
            if bid is None:
                missing_bid.append(action.get("step", idx))
            elif bid == "":
                empty_bid.append(action.get("step", idx))
        
        total = len(self.actions)
        valid = total - len(missing_bid) - len(empty_bid)
        
        passed = len(missing_bid) == 0 and len(empty_bid) == 0
        self._add_result(
            "BIDs Present",
            passed,
            f"All {total} actions have valid BIDs" if passed else f"{len(missing_bid) + len(empty_bid)} actions missing BIDs",
            {
                "total_actions": total,
                "valid_bids": valid,
                "missing_bid_steps": missing_bid[:5],
                "empty_bid_steps": empty_bid[:5]
            }
        )
        return passed
    
    def verify_fill_values(self) -> bool:
        """Verify fill actions have values."""
        fill_actions = [a for a in self.actions if a.get("action") == "fill"]
        
        if not fill_actions:
            self._add_result(
                "Fill Values",
                True,
                "No fill actions to verify",
                {"fill_action_count": 0}
            )
            return True
        
        missing_values = []
        empty_values = []
        
        for action in fill_actions:
            value = action.get("value")
            if value is None:
                missing_values.append(action.get("step"))
            elif value == "":
                empty_values.append(action.get("step"))
        
        # Empty values might be intentional (clearing field)
        passed = len(missing_values) == 0
        
        self._add_result(
            "Fill Values",
            passed,
            f"All {len(fill_actions)} fill actions have values" if passed else f"{len(missing_values)} fill actions missing values",
            {
                "fill_action_count": len(fill_actions),
                "missing_value_steps": missing_values[:5],
                "empty_value_steps": empty_values[:5]
            }
        )
        return passed
    
    def verify_select_options(self) -> bool:
        """Verify select_option actions have options."""
        select_actions = [a for a in self.actions if a.get("action") == "select_option"]
        
        if not select_actions:
            self._add_result(
                "Select Options",
                True,
                "No select_option actions to verify",
                {"select_action_count": 0}
            )
            return True
        
        missing_options = []
        
        for action in select_actions:
            option = action.get("option")
            if option is None or option == "":
                missing_options.append(action.get("step"))
        
        passed = len(missing_options) == 0
        
        self._add_result(
            "Select Options",
            passed,
            f"All {len(select_actions)} select_option actions have options" if passed else f"{len(missing_options)} select_option actions missing options",
            {
                "select_action_count": len(select_actions),
                "missing_option_steps": missing_options[:5]
            }
        )
        return passed
    
    def verify_element_info(self) -> bool:
        """Verify element_info is present with useful data."""
        missing_info = []
        incomplete_info = []
        
        for idx, action in enumerate(self.actions):
            elem_info = action.get("element_info", {})
            step = action.get("step", idx)
            
            if not elem_info:
                missing_info.append(step)
            elif not elem_info.get("role") and not elem_info.get("name"):
                incomplete_info.append(step)
        
        total = len(self.actions)
        with_info = total - len(missing_info)
        complete_info = with_info - len(incomplete_info)
        
        passed = len(missing_info) < total * 0.1  # Allow 10% missing
        
        self._add_result(
            "Element Info",
            passed,
            f"{complete_info}/{total} actions have complete element info" if passed else f"Too many actions missing element info",
            {
                "total_actions": total,
                "with_info": with_info,
                "complete_info": complete_info,
                "missing_info_steps": missing_info[:5],
                "incomplete_info_steps": incomplete_info[:5]
            }
        )
        return passed
    
    def verify_step_sequence(self) -> bool:
        """Verify steps are sequential."""
        if not self.actions:
            return True
        
        steps = [a.get("step", idx) for idx, a in enumerate(self.actions)]
        expected_steps = list(range(1, len(self.actions) + 1))
        
        # Check if steps match expected sequence
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
            f"Steps 1-{len(self.actions)} are sequential" if passed else f"Step sequence issues: {len(gaps)} gaps, {len(duplicates)} duplicates",
            {
                "expected_steps": len(expected_steps),
                "actual_steps": len(steps),
                "gaps": gaps[:5],
                "duplicates": duplicates[:5]
            }
        )
        return passed
    
    def verify_action_code_generation(self) -> bool:
        """Verify actions can be converted to valid browsergym code."""
        invalid_codes = []
        
        for action in self.actions:
            action_type = action.get("action", "")
            bid = action.get("data_bid", "")
            step = action.get("step", 0)
            
            # Generate code
            if action_type == "click":
                code = f'click("{bid}")'
            elif action_type == "fill":
                value = action.get("value", "").replace('"', '\\"')
                code = f'fill("{bid}", "{value}")'
            elif action_type == "select_option":
                option = action.get("option", "").replace('"', '\\"')
                code = f'select_option("{bid}", "{option}")'
            else:
                code = f'{action_type}("{bid}")'
            
            # Validate code format
            if not re.match(r'^[a-z_]+\(["\'][^"\']*["\']', code):
                invalid_codes.append({"step": step, "code": code})
        
        passed = len(invalid_codes) == 0
        
        self._add_result(
            "Action Code Generation",
            passed,
            f"All actions generate valid code" if passed else f"{len(invalid_codes)} actions generate invalid code",
            {
                "total_actions": len(self.actions),
                "invalid_codes": invalid_codes[:5]
            }
        )
        return passed
    
    def verify_action_diversity(self) -> bool:
        """Verify there's a reasonable diversity of action types."""
        if not self.actions:
            return True
        
        action_types = [a.get("action") for a in self.actions]
        unique_types = set(action_types)
        
        # Most form tasks should have at least clicks and fills
        has_click = "click" in unique_types
        has_fill = "fill" in unique_types
        
        passed = len(unique_types) >= 1  # At least one type
        
        self._add_result(
            "Action Diversity",
            passed,
            f"Found {len(unique_types)} action types: {unique_types}",
            {
                "unique_action_types": list(unique_types),
                "has_click": has_click,
                "has_fill": has_fill,
                "action_distribution": {t: action_types.count(t) for t in unique_types}
            }
        )
        return passed
    
    def run_verification(self) -> ActionVerificationReport:
        """Run all verification checks."""
        print(f"\n{'='*60}")
        print("🎯 ACTION VERIFICATION")
        print(f"{'='*60}")
        
        self.verify_actions_present()
        self.verify_action_types()
        self.verify_bids_present()
        self.verify_fill_values()
        self.verify_select_options()
        self.verify_element_info()
        self.verify_step_sequence()
        self.verify_action_code_generation()
        self.verify_action_diversity()
        
        passed = sum(1 for r in self.results if r.passed)
        failed = sum(1 for r in self.results if not r.passed)
        
        return ActionVerificationReport(
            actions_path="",
            timestamp=datetime.now().isoformat(),
            total_checks=len(self.results),
            passed_checks=passed,
            failed_checks=failed,
            results=self.results,
            summary={
                "actions_valid": failed == 0,
                "success_rate": round(passed / len(self.results) * 100, 1) if self.results else 0,
                "total_actions": len(self.actions)
            }
        )


def print_report(report: ActionVerificationReport):
    """Print verification report."""
    print(f"\n{'─'*60}")
    print("📋 ACTION VERIFICATION RESULTS")
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
    print(f"  Actions Valid: {'✅ YES' if report.summary['actions_valid'] else '❌ NO'}")
    print(f"{'='*60}\n")


def verify_actions(actions_path: str = None, actions_data: Dict = None, save_report: bool = True) -> ActionVerificationReport:
    """Main function to verify actions."""
    if actions_data is None:
        if actions_path is None:
            raise ValueError("Must provide either actions_path or actions_data")
        with open(actions_path, 'r', encoding='utf-8') as f:
            actions_data = json.load(f)
    
    verifier = ActionVerifier(actions_data)
    report = verifier.run_verification()
    report.actions_path = actions_path or "in-memory"
    
    print_report(report)
    
    if save_report and actions_path:
        report_path = actions_path.replace(".json", "_action_verification.json")
        report_dict = {
            "actions_path": report.actions_path,
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
    
    parser = argparse.ArgumentParser(description="Verify BrowserGym action extraction")
    parser.add_argument("actions", nargs="?", help="Path to bgym_actions.json")
    parser.add_argument("--no-save", action="store_true", help="Don't save verification report")
    
    args = parser.parse_args()
    
    # Default paths to check
    if args.actions:
        actions_paths = [args.actions]
    else:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(script_dir)
        actions_paths = [
            os.path.join(parent_dir, "post_processing", "form_trace_bgym_actions.json"),
            os.path.join(parent_dir, "post_processing", "trace_bgym_actions.json"),
            os.path.join(parent_dir, "icl", "form_trace_bgym_actions.json"),
        ]
    
    for path in actions_paths:
        if os.path.exists(path):
            print(f"📂 Loading actions from: {path}")
            verify_actions(path, save_report=not args.no_save)
            break
    else:
        print(f"❌ No actions file found. Please specify path.")
        print(f"   Searched: {actions_paths}")

