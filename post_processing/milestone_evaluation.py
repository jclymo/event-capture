# milestone_evaluation.py
# Compare agent actions with ground truth from form_trace and calculate partial scores

import json
import os
import re
from typing import Dict, List, Tuple, Any
from dataclasses import dataclass, field
from collections import defaultdict

# ============================================================
# GROUND TRUTH MILESTONES (Semantic, not BID-based)
# ============================================================

# Define milestones based on semantic actions, not exact BIDs
# All milestones have equal weight (1.0)
MILESTONES = [
    {"id": 1, "name": "Click Model Category Field", "action": "click", "target_type": "lookup_field", "field": "model_category", "weight": 1.0},
    {"id": 2, "name": "Select Computer Category", "action": "click", "target_type": "option", "value": "Computer", "weight": 1.0},
    {"id": 3, "name": "Select Model (MacBook)", "action": "click", "target_type": "option", "value": "MacBook|Apple", "weight": 1.0},
    {"id": 4, "name": "Click Depreciation Field", "action": "click", "target_type": "lookup_field", "field": "depreciation", "weight": 1.0},
    {"id": 5, "name": "Select Depreciation Option", "action": "click", "target_type": "option", "value": "SL 5 Years|Years", "weight": 1.0},
    {"id": 6, "name": "Navigate to Financial Tab", "action": "click", "target_type": "tab", "value": "Financial", "weight": 1.0},
    {"id": 7, "name": "Fill Cost/Financial Field", "action": "fill", "target_type": "textbox", "weight": 1.0},
    {"id": 8, "name": "Navigate to General Tab", "action": "click", "target_type": "tab", "value": "General", "weight": 1.0},
    {"id": 9, "name": "Fill Asset Tag", "action": "fill", "target_type": "textbox", "value_pattern": "SN-", "weight": 1.0},
    {"id": 10, "name": "Click Location Field", "action": "click", "target_type": "lookup_field", "field": "location|department", "weight": 1.0},
    {"id": 11, "name": "Select Location", "action": "click", "target_type": "option", "weight": 1.0},
    {"id": 12, "name": "Fill Quantity Field", "action": "fill", "target_type": "textbox", "weight": 1.0},
    {"id": 13, "name": "Select Vendor/Manufacturer", "action": "click", "target_type": "option", "value": "Apple", "weight": 1.0},
    {"id": 14, "name": "Navigate to Disposal Tab", "action": "click", "target_type": "tab", "value": "Disposal", "weight": 1.0},
    {"id": 15, "name": "Fill Disposal Field", "action": "fill", "target_type": "textbox", "weight": 1.0},
    {"id": 16, "name": "Select Department", "action": "click", "target_type": "option", "value": "IT", "weight": 1.0},
    {"id": 17, "name": "Navigate to Depreciation Tab", "action": "click", "target_type": "tab", "value": "Depreciation", "weight": 1.0},
    {"id": 18, "name": "Click Submit Button", "action": "click", "target_type": "button", "value": "Submit|Insert|Save", "weight": 1.0},
]

# ============================================================
# ACTION PARSING
# ============================================================

def parse_action(action_str: str) -> Dict:
    """Parse an action string like click('123') or fill('456', 'value')"""
    action_str = action_str.strip()
    
    # Match patterns
    click_match = re.match(r"click\(['\"]?([^'\"]+)['\"]?\)", action_str)
    fill_match = re.match(r"fill\(['\"]?([^'\"]+)['\"]?,\s*['\"](.+)['\"]\)", action_str)
    select_match = re.match(r"select_option\(['\"]?([^'\"]+)['\"]?,\s*['\"](.+)['\"]\)", action_str)
    
    if fill_match:
        return {
            "type": "fill",
            "bid": fill_match.group(1),
            "value": fill_match.group(2)
        }
    elif select_match:
        return {
            "type": "select_option",
            "bid": select_match.group(1),
            "value": select_match.group(2)
        }
    elif click_match:
        return {
            "type": "click",
            "bid": click_match.group(1),
            "value": None
        }
    else:
        return {"type": "unknown", "raw": action_str}


def action_matches_milestone(action: Dict, milestone: Dict) -> Tuple[bool, float]:
    """
    Check if an action matches a milestone.
    Returns (matched, confidence_score)
    """
    action_type = action.get("type", "")
    value = action.get("value", "")
    
    # Check action type
    if milestone["action"] == "fill" and action_type not in ["fill", "select_option"]:
        return False, 0.0
    if milestone["action"] == "click" and action_type not in ["click", "select_option"]:
        return False, 0.0
    
    # For fills, check value pattern if specified
    if milestone["action"] == "fill":
        if action_type in ["fill", "select_option"] and value:
            if "value_pattern" in milestone:
                if milestone["value_pattern"] in value:
                    return True, 1.0
                return True, 0.5  # Partial credit for any fill
            return True, 0.7  # Generic fill
    
    # For clicks with specific value matching
    if milestone["action"] == "click" and "value" in milestone:
        patterns = milestone["value"].split("|")
        if value:
            for pattern in patterns:
                if pattern.lower() in value.lower():
                    return True, 1.0
        # Partial credit for clicking something related
        return False, 0.0
    
    # Generic click (like clicking on a field)
    if milestone["action"] == "click" and action_type == "click":
        return True, 0.3  # Low confidence for generic clicks
    
    return False, 0.0


# ============================================================
# MILESTONE TRACKING
# ============================================================

@dataclass
class MilestoneResult:
    milestone_id: int
    milestone_name: str
    completed: bool
    partial_score: float
    matched_action: str = ""
    action_index: int = -1


def evaluate_trajectory(actions: List[str], milestones: List[Dict]) -> Dict:
    """
    Evaluate a trajectory against milestones.
    Uses greedy matching - each milestone can only be matched once.
    """
    results = {
        "total_milestones": len(milestones),
        "completed_milestones": 0,
        "partial_score": 0.0,
        "max_score": sum(m["weight"] for m in milestones),
        "milestone_details": [],
        "action_coverage": 0.0,
        "matched_actions": []
    }
    
    # Track which milestones have been matched
    matched_milestones = set()
    matched_action_indices = set()
    
    # Parse all actions
    parsed_actions = [parse_action(a) for a in actions]
    
    # For each action, find best matching unmatched milestone
    for action_idx, action in enumerate(parsed_actions):
        if action["type"] == "unknown":
            continue
            
        best_milestone_idx = -1
        best_score = 0.0
        
        for m_idx, milestone in enumerate(milestones):
            if m_idx in matched_milestones:
                continue
            
            matched, score = action_matches_milestone(action, milestone)
            if matched and score > best_score:
                best_score = score
                best_milestone_idx = m_idx
        
        if best_milestone_idx >= 0 and best_score > 0.3:  # Threshold
            milestone = milestones[best_milestone_idx]
            matched_milestones.add(best_milestone_idx)
            matched_action_indices.add(action_idx)
            
            weighted_score = best_score * milestone["weight"]
            results["partial_score"] += weighted_score
            
            if best_score >= 0.7:
                results["completed_milestones"] += 1
            
            results["milestone_details"].append(MilestoneResult(
                milestone_id=milestone["id"],
                milestone_name=milestone["name"],
                completed=best_score >= 0.7,
                partial_score=weighted_score,
                matched_action=actions[action_idx],
                action_index=action_idx
            ))
            
            results["matched_actions"].append({
                "action": actions[action_idx],
                "milestone": milestone["name"],
                "score": best_score
            })
    
    # Add unmatched milestones
    for m_idx, milestone in enumerate(milestones):
        if m_idx not in matched_milestones:
            results["milestone_details"].append(MilestoneResult(
                milestone_id=milestone["id"],
                milestone_name=milestone["name"],
                completed=False,
                partial_score=0.0
            ))
    
    # Sort by milestone ID
    results["milestone_details"].sort(key=lambda x: x.milestone_id)
    
    # Calculate coverage
    if len(actions) > 0:
        results["action_coverage"] = len(matched_action_indices) / len(actions)
    
    # Normalize score to percentage
    results["score_percentage"] = (results["partial_score"] / results["max_score"]) * 100 if results["max_score"] > 0 else 0
    
    return results


# ============================================================
# EVALUATION
# ============================================================

def evaluate_all_runs(eval_results: Dict) -> Dict:
    """Evaluate all runs from the evaluation results."""
    
    summary = {
        "baseline": {"runs": [], "avg_score": 0, "avg_milestones": 0},
        "icl": {"runs": [], "avg_score": 0, "avg_milestones": 0}
    }
    
    for condition in ["baseline", "icl"]:
        for run in eval_results["evaluations"][condition]:
            actions = run.get("actions", [])
            
            # Evaluate against milestones
            result = evaluate_trajectory(actions, MILESTONES)
            
            run_result = {
                "model": run["model"],
                "seed": run["seed"],
                "original_success": run["success"],
                "original_reward": run["reward"],
                "steps": run["steps"],
                "total_actions": len(actions),
                "milestones_completed": result["completed_milestones"],
                "partial_score": result["partial_score"],
                "max_score": result["max_score"],
                "score_percentage": result["score_percentage"],
                "action_coverage": result["action_coverage"],
                "matched_actions": result["matched_actions"]
            }
            
            summary[condition]["runs"].append(run_result)
        
        # Calculate averages
        runs = summary[condition]["runs"]
        if runs:
            summary[condition]["avg_score"] = sum(r["score_percentage"] for r in runs) / len(runs)
            summary[condition]["avg_milestones"] = sum(r["milestones_completed"] for r in runs) / len(runs)
            summary[condition]["total_runs"] = len(runs)
    
    return summary


def print_evaluation_report(summary: Dict):
    """Print detailed evaluation report."""
    
    print("\n" + "="*80)
    print("📊 MILESTONE-BASED EVALUATION REPORT")
    print("="*80)
    
    print(f"\nTotal Milestones: {len(MILESTONES)}")
    print(f"Max Possible Score: {sum(m['weight'] for m in MILESTONES):.1f} points")
    
    # Overall comparison
    print(f"\n{'─'*80}")
    print("OVERALL COMPARISON")
    print(f"{'─'*80}")
    print(f"{'Condition':<15} {'Avg Score %':<15} {'Avg Milestones':<18} {'Runs':<10}")
    print("-" * 60)
    
    for condition in ["baseline", "icl"]:
        s = summary[condition]
        print(f"{condition.upper():<15} {s['avg_score']:.1f}%{'':<10} {s['avg_milestones']:.1f}/{len(MILESTONES)}{'':<8} {s['total_runs']}")
    
    improvement = summary["icl"]["avg_score"] - summary["baseline"]["avg_score"]
    print(f"\n📈 ICL Score Improvement: {improvement:+.1f}%")
    
    # Per-model breakdown
    print(f"\n{'─'*80}")
    print("BY MODEL")
    print(f"{'─'*80}")
    
    for condition in ["baseline", "icl"]:
        print(f"\n  📋 {condition.upper()}:")
        
        # Group by model
        model_stats = defaultdict(list)
        for run in summary[condition]["runs"]:
            model_stats[run["model"]].append(run)
        
        for model, runs in model_stats.items():
            avg_score = sum(r["score_percentage"] for r in runs) / len(runs)
            avg_milestones = sum(r["milestones_completed"] for r in runs) / len(runs)
            print(f"    {model}: Score={avg_score:.1f}%, Milestones={avg_milestones:.1f}/{len(MILESTONES)}")
    
    # Detailed run breakdown
    print(f"\n{'─'*80}")
    print("DETAILED RESULTS BY RUN")
    print(f"{'─'*80}")
    
    for condition in ["baseline", "icl"]:
        print(f"\n  📋 {condition.upper()}:")
        for run in sorted(summary[condition]["runs"], key=lambda x: (x["model"], x["seed"])):
            status = "✓" if run["original_success"] else "✗"
            print(f"    {run['model']} seed={run['seed']}: {status} Score={run['score_percentage']:.1f}%, "
                  f"Milestones={run['milestones_completed']}/{len(MILESTONES)}, "
                  f"Actions={run['total_actions']}")
            
            # Show matched actions
            if run["matched_actions"]:
                for ma in run["matched_actions"][:3]:  # Show first 3
                    print(f"      ✓ {ma['milestone']}: {ma['action'][:40]}... (score={ma['score']:.1f})")
                if len(run["matched_actions"]) > 3:
                    print(f"      ... and {len(run['matched_actions']) - 3} more matches")
    
    # Milestone coverage analysis
    print(f"\n{'─'*80}")
    print("MILESTONE COVERAGE ANALYSIS")
    print(f"{'─'*80}")
    
    for condition in ["baseline", "icl"]:
        print(f"\n  📋 {condition.upper()}:")
        
        # Count which milestones were hit
        milestone_hits = defaultdict(int)
        for run in summary[condition]["runs"]:
            for ma in run["matched_actions"]:
                milestone_hits[ma["milestone"]] += 1
        
        # Show most/least covered
        if milestone_hits:
            sorted_milestones = sorted(milestone_hits.items(), key=lambda x: x[1], reverse=True)
            print(f"    Most hit milestones:")
            for name, count in sorted_milestones[:5]:
                print(f"      - {name}: {count}/{len(summary[condition]['runs'])} runs")
        
        # Show never-hit milestones
        all_names = {m["name"] for m in MILESTONES}
        hit_names = set(milestone_hits.keys())
        never_hit = all_names - hit_names
        if never_hit:
            print(f"    Never hit milestones:")
            for name in list(never_hit)[:5]:
                print(f"      - {name}")


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Load evaluation results
    # Use the latest evaluation file (with improved prompts)
    eval_path = os.path.join(script_dir, "eval_comparison_20251207_152502.json")
    
    print(f"Loading evaluation results from: {eval_path}")
    
    with open(eval_path, 'r') as f:
        eval_results = json.load(f)
    
    # Evaluate all runs
    summary = evaluate_all_runs(eval_results)
    
    # Print report
    print_evaluation_report(summary)
    
    # Save detailed results
    output_path = os.path.join(script_dir, "milestone_evaluation_results.json")
    with open(output_path, 'w') as f:
        # Convert dataclasses to dicts for serialization
        serializable = {
            "baseline": {
                "runs": summary["baseline"]["runs"],
                "avg_score": summary["baseline"]["avg_score"],
                "avg_milestones": summary["baseline"]["avg_milestones"],
                "total_runs": summary["baseline"]["total_runs"]
            },
            "icl": {
                "runs": summary["icl"]["runs"],
                "avg_score": summary["icl"]["avg_score"],
                "avg_milestones": summary["icl"]["avg_milestones"],
                "total_runs": summary["icl"]["total_runs"]
            }
        }
        json.dump(serializable, f, indent=2)
    
    print(f"\n💾 Saved detailed results to: {output_path}")


if __name__ == "__main__":
    main()

