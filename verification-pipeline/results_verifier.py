"""
Results Verifier - Validates evaluation results

Checks:
- Results structure validity
- Evaluation statistics
- Success rate calculations
- Model comparison validity
- Data consistency
"""

import json
import os
from typing import Dict, List, Any
from dataclasses import dataclass, field
from datetime import datetime
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@dataclass
class ResultsVerificationResult:
    """Result of a results verification check."""
    name: str
    passed: bool
    message: str
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ResultsVerificationReport:
    """Complete results verification report."""
    results_path: str
    timestamp: str
    total_checks: int
    passed_checks: int
    failed_checks: int
    results: List[ResultsVerificationResult] = field(default_factory=list)
    summary: Dict[str, Any] = field(default_factory=dict)


class ResultsVerifier:
    """Verifies evaluation results."""
    
    REQUIRED_TOP_FIELDS = ["task_id", "timestamp", "seeds", "models"]
    REQUIRED_EVAL_FIELDS = ["model", "seed", "success", "reward", "steps"]
    
    def __init__(self, results_data: Dict):
        self.results_data = results_data
        self.results: List[ResultsVerificationResult] = []
    
    def _add_result(self, name: str, passed: bool, message: str, details: Dict = None):
        """Add a verification result."""
        self.results.append(ResultsVerificationResult(
            name=name,
            passed=passed,
            message=message,
            details=details or {}
        ))
    
    def verify_structure(self) -> bool:
        """Verify results have required structure."""
        missing = []
        for field in self.REQUIRED_TOP_FIELDS:
            if field not in self.results_data:
                missing.append(field)
        
        passed = len(missing) == 0
        
        self._add_result(
            "Results Structure",
            passed,
            "All required fields present" if passed else f"Missing: {missing}",
            {"found_fields": list(self.results_data.keys()), "missing": missing}
        )
        return passed
    
    def verify_evaluations_present(self) -> bool:
        """Verify evaluations data exists."""
        evaluations = self.results_data.get("evaluations", {})
        
        # Handle both list and dict formats
        if isinstance(evaluations, list):
            has_evals = len(evaluations) > 0
            eval_count = len(evaluations)
        elif isinstance(evaluations, dict):
            has_evals = any(len(v) > 0 for v in evaluations.values() if isinstance(v, list))
            eval_count = sum(len(v) for v in evaluations.values() if isinstance(v, list))
        else:
            has_evals = False
            eval_count = 0
        
        self._add_result(
            "Evaluations Present",
            has_evals,
            f"Found {eval_count} evaluations" if has_evals else "No evaluations found",
            {"evaluation_count": eval_count}
        )
        return has_evals
    
    def _get_all_runs(self) -> List[Dict]:
        """Extract all runs from evaluations."""
        evaluations = self.results_data.get("evaluations", {})
        
        if isinstance(evaluations, list):
            # List of model results
            all_runs = []
            for model_result in evaluations:
                runs = model_result.get("runs", [])
                all_runs.extend(runs)
            return all_runs
        elif isinstance(evaluations, dict):
            # Dict with conditions (baseline, icl)
            all_runs = []
            for condition, runs in evaluations.items():
                if isinstance(runs, list):
                    all_runs.extend(runs)
            return all_runs
        return []
    
    def verify_run_structure(self) -> bool:
        """Verify individual run structure."""
        all_runs = self._get_all_runs()
        
        if not all_runs:
            self._add_result(
                "Run Structure",
                False,
                "No runs to verify",
                {}
            )
            return False
        
        invalid_runs = []
        for idx, run in enumerate(all_runs):
            missing = []
            for field in self.REQUIRED_EVAL_FIELDS:
                if field not in run:
                    missing.append(field)
            if missing:
                invalid_runs.append({"index": idx, "missing": missing})
        
        passed = len(invalid_runs) == 0
        
        self._add_result(
            "Run Structure",
            passed,
            f"All {len(all_runs)} runs have valid structure" if passed else f"{len(invalid_runs)} runs invalid",
            {"total_runs": len(all_runs), "invalid_runs": invalid_runs[:5]}
        )
        return passed
    
    def verify_success_rate_calculation(self) -> bool:
        """Verify success rate calculations are correct."""
        all_runs = self._get_all_runs()
        
        if not all_runs:
            return False
        
        # Calculate actual success rate
        successes = sum(1 for r in all_runs if r.get("success", False))
        total = len(all_runs)
        actual_rate = successes / total if total > 0 else 0
        
        # Check reported summary
        summary = self.results_data.get("summary", {})
        
        issues = []
        
        # Check overall success rate
        reported_overall = summary.get("overall_success_rate")
        if reported_overall is not None:
            if abs(reported_overall - actual_rate) > 0.01:
                issues.append(f"Overall rate mismatch: reported {reported_overall:.2f} vs actual {actual_rate:.2f}")
        
        passed = len(issues) == 0
        
        self._add_result(
            "Success Rate Calculation",
            passed,
            f"Success rate: {actual_rate*100:.1f}% ({successes}/{total})" if passed else f"Calculation issues: {issues}",
            {
                "total_runs": total,
                "successes": successes,
                "actual_rate": round(actual_rate, 4),
                "reported_rate": reported_overall,
                "issues": issues
            }
        )
        return passed
    
    def verify_seeds_coverage(self) -> bool:
        """Verify all seeds were evaluated."""
        expected_seeds = set(self.results_data.get("seeds", []))
        all_runs = self._get_all_runs()
        
        if not expected_seeds:
            self._add_result(
                "Seeds Coverage",
                True,
                "No expected seeds defined",
                {}
            )
            return True
        
        actual_seeds = set(r.get("seed") for r in all_runs if "seed" in r)
        
        missing_seeds = expected_seeds - actual_seeds
        extra_seeds = actual_seeds - expected_seeds
        
        passed = len(missing_seeds) == 0
        
        self._add_result(
            "Seeds Coverage",
            passed,
            f"All {len(expected_seeds)} seeds covered" if passed else f"Missing seeds: {missing_seeds}",
            {
                "expected_seeds": list(expected_seeds),
                "actual_seeds": list(actual_seeds),
                "missing": list(missing_seeds),
                "extra": list(extra_seeds)
            }
        )
        return passed
    
    def verify_models_coverage(self) -> bool:
        """Verify all models were evaluated."""
        expected_models = set(self.results_data.get("models", []))
        all_runs = self._get_all_runs()
        
        if not expected_models:
            self._add_result(
                "Models Coverage",
                True,
                "No expected models defined",
                {}
            )
            return True
        
        actual_models = set(r.get("model") for r in all_runs if "model" in r)
        
        missing_models = expected_models - actual_models
        
        passed = len(missing_models) == 0
        
        self._add_result(
            "Models Coverage",
            passed,
            f"All {len(expected_models)} models covered" if passed else f"Missing models: {missing_models}",
            {
                "expected_models": list(expected_models),
                "actual_models": list(actual_models),
                "missing": list(missing_models)
            }
        )
        return passed
    
    def verify_reward_values(self) -> bool:
        """Verify reward values are valid."""
        all_runs = self._get_all_runs()
        
        if not all_runs:
            return False
        
        invalid_rewards = []
        reward_distribution = {"positive": 0, "zero": 0, "negative": 0}
        
        for idx, run in enumerate(all_runs):
            reward = run.get("reward")
            
            if reward is None:
                invalid_rewards.append({"index": idx, "issue": "missing reward"})
            elif not isinstance(reward, (int, float)):
                invalid_rewards.append({"index": idx, "issue": f"invalid type: {type(reward)}"})
            else:
                if reward > 0:
                    reward_distribution["positive"] += 1
                elif reward < 0:
                    reward_distribution["negative"] += 1
                else:
                    reward_distribution["zero"] += 1
        
        passed = len(invalid_rewards) == 0
        
        self._add_result(
            "Reward Values",
            passed,
            f"All rewards valid: {reward_distribution}" if passed else f"{len(invalid_rewards)} invalid rewards",
            {
                "total_runs": len(all_runs),
                "invalid_rewards": invalid_rewards[:5],
                "distribution": reward_distribution
            }
        )
        return passed
    
    def verify_step_counts(self) -> bool:
        """Verify step counts are reasonable."""
        all_runs = self._get_all_runs()
        
        if not all_runs:
            return False
        
        steps = [r.get("steps", 0) for r in all_runs if "steps" in r]
        
        if not steps:
            self._add_result(
                "Step Counts",
                False,
                "No step data found",
                {}
            )
            return False
        
        min_steps = min(steps)
        max_steps = max(steps)
        avg_steps = sum(steps) / len(steps)
        
        # Check for reasonable values
        issues = []
        if min_steps < 0:
            issues.append(f"Negative steps found: {min_steps}")
        if max_steps > 1000:
            issues.append(f"Unusually high step count: {max_steps}")
        
        passed = len(issues) == 0
        
        self._add_result(
            "Step Counts",
            passed,
            f"Steps range: {min_steps}-{max_steps}, avg: {avg_steps:.1f}" if passed else f"Issues: {issues}",
            {
                "min_steps": min_steps,
                "max_steps": max_steps,
                "avg_steps": round(avg_steps, 1),
                "issues": issues
            }
        )
        return passed
    
    def verify_success_reward_consistency(self) -> bool:
        """Verify success flag matches positive reward."""
        all_runs = self._get_all_runs()
        
        if not all_runs:
            return False
        
        inconsistent = []
        
        for idx, run in enumerate(all_runs):
            success = run.get("success", False)
            reward = run.get("reward", 0)
            
            # Success should correlate with positive reward
            if success and reward <= 0:
                inconsistent.append({
                    "index": idx,
                    "success": success,
                    "reward": reward,
                    "issue": "success=True but reward<=0"
                })
            elif not success and reward > 0:
                inconsistent.append({
                    "index": idx,
                    "success": success,
                    "reward": reward,
                    "issue": "success=False but reward>0"
                })
        
        passed = len(inconsistent) == 0
        
        self._add_result(
            "Success-Reward Consistency",
            passed,
            "Success flags match reward values" if passed else f"{len(inconsistent)} inconsistencies",
            {
                "total_runs": len(all_runs),
                "inconsistent": inconsistent[:5]
            }
        )
        return passed
    
    def verify_timestamps(self) -> bool:
        """Verify timestamp is valid."""
        timestamp = self.results_data.get("timestamp", "")
        
        try:
            dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            passed = True
            message = f"Valid timestamp: {timestamp}"
        except (ValueError, TypeError):
            passed = False
            message = f"Invalid timestamp format: {timestamp}"
        
        self._add_result(
            "Timestamp",
            passed,
            message,
            {"timestamp": timestamp}
        )
        return passed
    
    def run_verification(self) -> ResultsVerificationReport:
        """Run all verification checks."""
        print(f"\n{'='*60}")
        print("📊 RESULTS VERIFICATION")
        print(f"{'='*60}")
        
        self.verify_structure()
        self.verify_evaluations_present()
        self.verify_run_structure()
        self.verify_success_rate_calculation()
        self.verify_seeds_coverage()
        self.verify_models_coverage()
        self.verify_reward_values()
        self.verify_step_counts()
        self.verify_success_reward_consistency()
        self.verify_timestamps()
        
        passed = sum(1 for r in self.results if r.passed)
        failed = sum(1 for r in self.results if not r.passed)
        
        return ResultsVerificationReport(
            results_path="",
            timestamp=datetime.now().isoformat(),
            total_checks=len(self.results),
            passed_checks=passed,
            failed_checks=failed,
            results=self.results,
            summary={
                "results_valid": failed == 0,
                "success_rate": round(passed / len(self.results) * 100, 1) if self.results else 0
            }
        )


def print_report(report: ResultsVerificationReport):
    """Print verification report."""
    print(f"\n{'─'*60}")
    print("📋 RESULTS VERIFICATION RESULTS")
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
    print(f"  Results Valid: {'✅ YES' if report.summary['results_valid'] else '❌ NO'}")
    print(f"{'='*60}\n")


def verify_results(results_path: str = None, results_data: Dict = None, save_report: bool = True) -> ResultsVerificationReport:
    """Main function to verify results."""
    if results_data is None:
        if results_path is None:
            raise ValueError("Must provide either results_path or results_data")
        with open(results_path, 'r', encoding='utf-8') as f:
            results_data = json.load(f)
    
    verifier = ResultsVerifier(results_data)
    report = verifier.run_verification()
    report.results_path = results_path or "in-memory"
    
    print_report(report)
    
    if save_report and results_path:
        report_path = results_path.replace(".json", "_results_verification.json")
        report_dict = {
            "results_path": report.results_path,
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
    import glob
    
    parser = argparse.ArgumentParser(description="Verify evaluation results")
    parser.add_argument("results", nargs="?", help="Path to eval results JSON")
    parser.add_argument("--no-save", action="store_true", help="Don't save verification report")
    
    args = parser.parse_args()
    
    # Default paths to check
    if args.results:
        results_paths = [args.results]
    else:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(script_dir)
        
        # Find most recent eval results
        patterns = [
            os.path.join(parent_dir, "post_processing", "eval_comparison_*.json"),
            os.path.join(parent_dir, "post_processing", "eval_results_*.json"),
            os.path.join(parent_dir, "icl", "eval_results_*.json"),
        ]
        
        results_paths = []
        for pattern in patterns:
            results_paths.extend(glob.glob(pattern))
        
        # Sort by modification time, newest first
        results_paths.sort(key=lambda x: os.path.getmtime(x), reverse=True)
    
    if results_paths:
        path = results_paths[0]
        print(f"📂 Loading results from: {path}")
        verify_results(path, save_report=not args.no_save)
    else:
        print(f"❌ No results file found. Please specify path.")

