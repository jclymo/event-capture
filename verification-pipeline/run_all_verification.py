"""
Run All Verification - Master script to run entire verification pipeline

Orchestrates all verification checks:
1. Environment verification
2. Trace verification
3. Action extraction verification
4. Prompt verification
5. Pairing verification
6. Results verification
"""

import json
import os
import sys
import glob
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Any, Optional

# Add parent for imports
script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, script_dir)
sys.path.insert(0, os.path.dirname(script_dir))

from trace_verifier import verify_trace, TraceVerificationReport
from action_verifier import verify_actions, ActionVerificationReport
from prompt_verifier import verify_prompt, PromptVerificationReport
from pairing_verifier import verify_pairing, PairingVerificationReport
from env_verifier import verify_environment, EnvVerificationReport
from results_verifier import verify_results, ResultsVerificationReport


@dataclass
class PipelineReport:
    """Complete pipeline verification report."""
    timestamp: str
    total_verifiers: int
    passed_verifiers: int
    failed_verifiers: int
    verifier_results: Dict[str, Any] = field(default_factory=dict)
    overall_summary: Dict[str, Any] = field(default_factory=dict)


def find_latest_file(patterns: List[str]) -> Optional[str]:
    """Find the most recently modified file matching any pattern."""
    all_files = []
    for pattern in patterns:
        all_files.extend(glob.glob(pattern))
    
    if not all_files:
        return None
    
    # Sort by modification time, newest first
    all_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
    return all_files[0]


def run_pipeline(
    trace_path: str = None,
    actions_path: str = None,
    prompt_path: str = None,
    trajectory_path: str = None,
    results_path: str = None,
    skip_env: bool = False,
    skip_slow: bool = False,
    save_reports: bool = True
) -> PipelineReport:
    """Run the complete verification pipeline."""
    
    parent_dir = os.path.dirname(script_dir)
    post_processing_dir = os.path.join(parent_dir, "post_processing")
    icl_dir = os.path.join(parent_dir, "icl")
    
    report = PipelineReport(
        timestamp=datetime.now().isoformat(),
        total_verifiers=0,
        passed_verifiers=0,
        failed_verifiers=0
    )
    
    print("\n" + "=" * 70)
    print("🚀 RUNNING COMPLETE VERIFICATION PIPELINE")
    print("=" * 70)
    print(f"Timestamp: {report.timestamp}")
    print("=" * 70)
    
    # ============================================================
    # 1. ENVIRONMENT VERIFICATION
    # ============================================================
    if not skip_env:
        print("\n" + "─" * 70)
        print("1️⃣  ENVIRONMENT VERIFICATION")
        print("─" * 70)
        
        try:
            env_report = verify_environment(quick=skip_slow, save_report=save_reports)
            report.verifier_results["environment"] = {
                "status": "passed" if env_report.summary["env_ready"] else "failed",
                "checks_passed": env_report.passed_checks,
                "checks_total": env_report.total_checks,
                "success_rate": env_report.summary["success_rate"]
            }
            report.total_verifiers += 1
            if env_report.summary["env_ready"]:
                report.passed_verifiers += 1
            else:
                report.failed_verifiers += 1
        except Exception as e:
            print(f"❌ Environment verification failed: {e}")
            report.verifier_results["environment"] = {"status": "error", "error": str(e)}
            report.total_verifiers += 1
            report.failed_verifiers += 1
    
    # ============================================================
    # 2. TRACE VERIFICATION
    # ============================================================
    print("\n" + "─" * 70)
    print("2️⃣  TRACE VERIFICATION")
    print("─" * 70)
    
    if not trace_path:
        trace_path = find_latest_file([
            os.path.join(post_processing_dir, "form_trace", "trace.json"),
            os.path.join(post_processing_dir, "trace.json"),
            os.path.join(parent_dir, "trace.json"),
        ])
    
    if trace_path and os.path.exists(trace_path):
        try:
            trace_report = verify_trace(trace_path, save_report=save_reports)
            report.verifier_results["trace"] = {
                "path": trace_path,
                "status": "passed" if trace_report.summary["trace_valid"] else "failed",
                "checks_passed": trace_report.passed_checks,
                "checks_total": trace_report.total_checks,
                "success_rate": trace_report.success_rate
            }
            report.total_verifiers += 1
            if trace_report.summary["trace_valid"]:
                report.passed_verifiers += 1
            else:
                report.failed_verifiers += 1
        except Exception as e:
            print(f"❌ Trace verification failed: {e}")
            report.verifier_results["trace"] = {"status": "error", "error": str(e)}
            report.total_verifiers += 1
            report.failed_verifiers += 1
    else:
        print("⚠️  No trace.json found, skipping trace verification")
        report.verifier_results["trace"] = {"status": "skipped", "reason": "file not found"}
    
    # ============================================================
    # 3. ACTION VERIFICATION
    # ============================================================
    print("\n" + "─" * 70)
    print("3️⃣  ACTION VERIFICATION")
    print("─" * 70)
    
    if not actions_path:
        actions_path = find_latest_file([
            os.path.join(post_processing_dir, "form_trace_bgym_actions.json"),
            os.path.join(post_processing_dir, "trace_bgym_actions.json"),
            os.path.join(icl_dir, "form_trace_bgym_actions.json"),
        ])
    
    if actions_path and os.path.exists(actions_path):
        try:
            actions_report = verify_actions(actions_path, save_report=save_reports)
            report.verifier_results["actions"] = {
                "path": actions_path,
                "status": "passed" if actions_report.summary["actions_valid"] else "failed",
                "checks_passed": actions_report.passed_checks,
                "checks_total": actions_report.total_checks,
                "success_rate": actions_report.summary["success_rate"]
            }
            report.total_verifiers += 1
            if actions_report.summary["actions_valid"]:
                report.passed_verifiers += 1
            else:
                report.failed_verifiers += 1
        except Exception as e:
            print(f"❌ Action verification failed: {e}")
            report.verifier_results["actions"] = {"status": "error", "error": str(e)}
            report.total_verifiers += 1
            report.failed_verifiers += 1
    else:
        print("⚠️  No actions file found, skipping action verification")
        report.verifier_results["actions"] = {"status": "skipped", "reason": "file not found"}
    
    # ============================================================
    # 4. PROMPT VERIFICATION
    # ============================================================
    print("\n" + "─" * 70)
    print("4️⃣  PROMPT VERIFICATION")
    print("─" * 70)
    
    if not prompt_path:
        prompt_path = find_latest_file([
            os.path.join(post_processing_dir, "create_hardware_asset_icl_prompt.txt"),
            os.path.join(icl_dir, "create_hardware_asset_icl_prompt.txt"),
            os.path.join(icl_dir, "context_prompt.txt"),
        ])
    
    if prompt_path and os.path.exists(prompt_path):
        try:
            prompt_report = verify_prompt(prompt_path, save_report=save_reports)
            report.verifier_results["prompt"] = {
                "path": prompt_path,
                "status": "passed" if prompt_report.summary["prompt_valid"] else "failed",
                "checks_passed": prompt_report.passed_checks,
                "checks_total": prompt_report.total_checks,
                "success_rate": prompt_report.summary["success_rate"]
            }
            report.total_verifiers += 1
            if prompt_report.summary["prompt_valid"]:
                report.passed_verifiers += 1
            else:
                report.failed_verifiers += 1
        except Exception as e:
            print(f"❌ Prompt verification failed: {e}")
            report.verifier_results["prompt"] = {"status": "error", "error": str(e)}
            report.total_verifiers += 1
            report.failed_verifiers += 1
    else:
        print("⚠️  No prompt file found, skipping prompt verification")
        report.verifier_results["prompt"] = {"status": "skipped", "reason": "file not found"}
    
    # ============================================================
    # 5. PAIRING VERIFICATION
    # ============================================================
    print("\n" + "─" * 70)
    print("5️⃣  PAIRING VERIFICATION")
    print("─" * 70)
    
    if not trajectory_path:
        trajectory_path = find_latest_file([
            os.path.join(post_processing_dir, "paired_trajectory.json"),
        ])
    
    if trajectory_path and os.path.exists(trajectory_path):
        try:
            pairing_report = verify_pairing(trajectory_path, save_report=save_reports)
            report.verifier_results["pairing"] = {
                "path": trajectory_path,
                "status": "passed" if pairing_report.summary["pairing_valid"] else "failed",
                "checks_passed": pairing_report.passed_checks,
                "checks_total": pairing_report.total_checks,
                "success_rate": pairing_report.summary["success_rate"]
            }
            report.total_verifiers += 1
            if pairing_report.summary["pairing_valid"]:
                report.passed_verifiers += 1
            else:
                report.failed_verifiers += 1
        except Exception as e:
            print(f"❌ Pairing verification failed: {e}")
            report.verifier_results["pairing"] = {"status": "error", "error": str(e)}
            report.total_verifiers += 1
            report.failed_verifiers += 1
    else:
        print("⚠️  No trajectory file found, skipping pairing verification")
        report.verifier_results["pairing"] = {"status": "skipped", "reason": "file not found"}
    
    # ============================================================
    # 6. RESULTS VERIFICATION
    # ============================================================
    print("\n" + "─" * 70)
    print("6️⃣  RESULTS VERIFICATION")
    print("─" * 70)
    
    if not results_path:
        results_path = find_latest_file([
            os.path.join(post_processing_dir, "eval_comparison_*.json"),
            os.path.join(post_processing_dir, "eval_results_*.json"),
            os.path.join(icl_dir, "eval_results_*.json"),
        ])
    
    if results_path and os.path.exists(results_path):
        try:
            results_report = verify_results(results_path, save_report=save_reports)
            report.verifier_results["results"] = {
                "path": results_path,
                "status": "passed" if results_report.summary["results_valid"] else "failed",
                "checks_passed": results_report.passed_checks,
                "checks_total": results_report.total_checks,
                "success_rate": results_report.summary["success_rate"]
            }
            report.total_verifiers += 1
            if results_report.summary["results_valid"]:
                report.passed_verifiers += 1
            else:
                report.failed_verifiers += 1
        except Exception as e:
            print(f"❌ Results verification failed: {e}")
            report.verifier_results["results"] = {"status": "error", "error": str(e)}
            report.total_verifiers += 1
            report.failed_verifiers += 1
    else:
        print("⚠️  No results file found, skipping results verification")
        report.verifier_results["results"] = {"status": "skipped", "reason": "file not found"}
    
    # ============================================================
    # FINAL SUMMARY
    # ============================================================
    report.overall_summary = {
        "pipeline_passed": report.failed_verifiers == 0,
        "verifiers_passed": report.passed_verifiers,
        "verifiers_failed": report.failed_verifiers,
        "verifiers_total": report.total_verifiers,
        "success_rate": round(report.passed_verifiers / report.total_verifiers * 100, 1) if report.total_verifiers > 0 else 0
    }
    
    print_final_summary(report)
    
    if save_reports:
        report_path = os.path.join(script_dir, f"pipeline_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
        with open(report_path, 'w') as f:
            json.dump({
                "timestamp": report.timestamp,
                "total_verifiers": report.total_verifiers,
                "passed_verifiers": report.passed_verifiers,
                "failed_verifiers": report.failed_verifiers,
                "verifier_results": report.verifier_results,
                "overall_summary": report.overall_summary
            }, f, indent=2)
        print(f"\n💾 Pipeline report saved to: {report_path}")
    
    return report


def print_final_summary(report: PipelineReport):
    """Print final pipeline summary."""
    print("\n" + "=" * 70)
    print("📊 PIPELINE VERIFICATION SUMMARY")
    print("=" * 70)
    
    print(f"\n{'Verifier':<20} {'Status':<12} {'Checks':<15} {'Rate':<10}")
    print("-" * 60)
    
    status_icons = {
        "passed": "✅",
        "failed": "❌",
        "error": "💥",
        "skipped": "⏭️"
    }
    
    for name, result in report.verifier_results.items():
        status = result.get("status", "unknown")
        icon = status_icons.get(status, "❓")
        
        if "checks_passed" in result:
            checks = f"{result['checks_passed']}/{result['checks_total']}"
            rate = f"{result.get('success_rate', 0):.1f}%"
        else:
            checks = "-"
            rate = "-"
        
        print(f"{name.capitalize():<20} {icon} {status:<9} {checks:<15} {rate:<10}")
    
    print("-" * 60)
    
    overall = report.overall_summary
    overall_icon = "✅" if overall["pipeline_passed"] else "❌"
    print(f"{'OVERALL':<20} {overall_icon} {'passed' if overall['pipeline_passed'] else 'failed':<9} {overall['verifiers_passed']}/{overall['verifiers_total']:<14} {overall['success_rate']:.1f}%")
    
    print("\n" + "=" * 70)
    if overall["pipeline_passed"]:
        print("🎉 ALL VERIFICATIONS PASSED!")
    else:
        print(f"⚠️  {overall['verifiers_failed']} VERIFIER(S) FAILED")
    print("=" * 70 + "\n")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Run complete verification pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_all_verification.py                    # Run all verifiers with auto-discovery
  python run_all_verification.py --skip-env         # Skip environment check
  python run_all_verification.py --quick            # Skip slow checks (API calls)
  python run_all_verification.py --trace path/to/trace.json  # Specify trace file
        """
    )
    
    parser.add_argument("--trace", help="Path to trace.json")
    parser.add_argument("--actions", help="Path to bgym_actions.json")
    parser.add_argument("--prompt", help="Path to ICL prompt file")
    parser.add_argument("--trajectory", help="Path to paired_trajectory.json")
    parser.add_argument("--results", help="Path to eval results JSON")
    parser.add_argument("--skip-env", action="store_true", help="Skip environment verification")
    parser.add_argument("--quick", action="store_true", help="Skip slow checks (API, Playwright)")
    parser.add_argument("--no-save", action="store_true", help="Don't save verification reports")
    
    args = parser.parse_args()
    
    report = run_pipeline(
        trace_path=args.trace,
        actions_path=args.actions,
        prompt_path=args.prompt,
        trajectory_path=args.trajectory,
        results_path=args.results,
        skip_env=args.skip_env,
        skip_slow=args.quick,
        save_reports=not args.no_save
    )
    
    # Exit with error code if any verification failed
    sys.exit(0 if report.overall_summary["pipeline_passed"] else 1)


if __name__ == "__main__":
    main()

