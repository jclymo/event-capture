# eval_baseline_vs_icl.py
# Compare Baseline (no ICL) vs ICL (with semantic demonstration)
# Uses multiprocessing for parallel execution

import json
import os
import time
import warnings
import logging
from datetime import datetime
from typing import Dict, List, Any, Tuple
from dataclasses import dataclass, asdict, field
from multiprocessing import Pool, cpu_count
import multiprocessing

# Must be at top before any imports that might use playwright
multiprocessing.set_start_method('spawn', force=True)

import gymnasium as gym
import browsergym.workarena
from openai import OpenAI
from dotenv import load_dotenv
from browsergym.utils.obs import flatten_axtree_to_str

# Suppress noisy warnings
warnings.filterwarnings("ignore")
logging.getLogger("asyncio").setLevel(logging.CRITICAL)

load_dotenv()

# ============================================================
# CONFIGURATION
# ============================================================

TASK_ID = "browsergym/workarena.servicenow.create-hardware-asset"
SEEDS = [55, 276, 91, 789, 419]  # 5 random seeds (not 42)
MODELS = [
    {"name": "gpt-4o", "temp": 0},
    {"name": "gpt-4o-mini", "temp": 0},
]
MAX_STEPS = 30
TIMEOUT = 120  # 2 minutes
MAX_REPEATED = 5
PARALLEL_WORKERS = 3  # Run 3 evaluations at a time

# ============================================================
# SEMANTIC ICL PROMPT
# ============================================================

SEMANTIC_ICL_PROMPT = """
============================================================
EXPERT DEMONSTRATION - CREATE HARDWARE ASSET IN SERVICENOW
============================================================

## GOAL INTERPRETATION
When creating a hardware asset, you receive a goal like:
"Create asset with model_category=Computer, model=Apple MacBook Pro, asset_tag=SN-xxx..."

You must fill EACH field with the EXACT value from the goal.

## SERVICENOW AXTREE PATTERNS

### Pattern 1: Lookup Fields (Model Category, Model, Location, etc.)
In the axtree, lookup fields look like:
```
[bid] textbox "Model category" focused
[bid2] button "Lookup using list"  <-- CLICK THIS FIRST
```
After clicking lookup, options appear:
```
[bid3] option "Computer"  <-- THEN CLICK THE MATCHING OPTION
[bid4] option "Printer"
```

**Workflow:**
1. Find the lookup button near the field name
2. click(lookup_button_bid)
3. Find the option matching your goal value
4. click(option_bid)

### Pattern 2: Text Input Fields (Asset Tag, Serial Number, Cost)
```
[bid] textbox "Asset tag" 
```
**Workflow:** fill(bid, "SN-your-value-from-goal")

### Pattern 3: Tabs
```
[bid] tab "General"
[bid2] tab "Financial" 
[bid3] tab "Disposal"
```
**Workflow:** click(tab_bid) to switch sections

### Pattern 4: Submit Button
```
[bid] button "Submit"
```
**Workflow:** click(bid) AFTER filling all required fields

## COMPLETE EXAMPLE TRAJECTORY

Goal: model_category=Computer, model=Apple MacBook Pro 15", asset_tag=SN-abc123

Step 1: Find "Model category" lookup → click('lookup_bid')
Step 2: See options, find "Computer" → click('computer_option_bid')  
Step 3: Find "Model" lookup → click('model_lookup_bid')
Step 4: See options, find "Apple MacBook Pro 15"" → click('macbook_option_bid')
Step 5: Find "Asset tag" textbox → fill('asset_tag_bid', 'SN-abc123')
Step 6: Find "Submit" button → click('submit_bid')

## CRITICAL TIPS

1. **READ THE GOAL** - Extract exact values like "Computer", "Apple MacBook Pro"
2. **LOOKUP FIELDS** - Click the lookup/magnifying glass button, NOT the textbox
3. **WAIT FOR OPTIONS** - After clicking lookup, options appear in the axtree
4. **MATCH EXACTLY** - Find options that match your goal values
5. **TEXT FIELDS** - Use fill() with exact value from goal
6. **CHECK TABS** - Some fields are on Financial, Disposal, or other tabs
7. **SUBMIT LAST** - Only click Submit after filling all fields

## COMMON MISTAKES TO AVOID
- DON'T keep clicking the same element repeatedly
- DON'T use select_option on non-dropdown elements  
- DON'T fill lookup fields - click the lookup icon instead
- DON'T submit before filling required fields

============================================================
"""

BASELINE_SYSTEM_PROMPT = """You are an expert AI agent controlling a web browser to complete ServiceNow forms.

## YOUR TASK
Read the goal carefully. Extract the EXACT field values you need to fill. Then find matching elements in the accessibility tree.

## AVAILABLE ACTIONS
- click(bid): Click element - use for buttons, tabs, dropdowns, lookup icons
- fill(bid, text): Type into text fields - find elements with role="textbox"  
- select_option(bid, option): Select from dropdown AFTER it's open
- scroll(x, y): Scroll if needed
- noop(): Wait/do nothing

## SERVICENOW FORM PATTERNS

1. **Lookup/Reference Fields** (like Model Category, Model, Location):
   - These show a text input with a magnifying glass icon
   - First: click() on the lookup icon (usually has "Lookup" in name)
   - Then: A dropdown appears with options
   - Finally: click() on the option that matches your value

2. **Text Input Fields** (like Asset Tag, Serial Number):
   - Find by role="textbox" and matching name
   - Use fill(bid, "your value")

3. **Dropdown Fields**:
   - click() to open, then click() the option

4. **Tabs** (General, Financial, Disposal, Depreciation):
   - Look for role="tab" with the tab name
   - click() to switch tabs

5. **Submit**:
   - Look for role="button" with name="Submit" or "Insert"

## CRITICAL RULES
- ALWAYS check the goal for exact values to fill
- Match field names from goal to element names in axtree
- For lookups: click the LOOKUP ICON first, not the text field
- Look for elements with the field name (e.g., "Model category" for model_category field)
- After clicking a lookup, wait for options then click the matching option

## OUTPUT FORMAT
Output ONLY the action code. No explanation. No markdown.
Example: click('123') or fill('456', 'some value')
"""

ICL_SYSTEM_PROMPT = f"""You are an AI agent controlling a web browser to complete a task.
You will receive the current goal and the current observation (accessibility tree).
Your goal is to complete the task efficiently.

Output ONLY the code for the next action to execute. Do not output markdown blocks or explanations.
Example: click('123') or fill('456', 'some value')

Available actions:
- click(bid): Click on element with given browsergym ID
- fill(bid, text): Type text into input element  
- select_option(bid, option): Select option from dropdown
- scroll(x, y): Scroll the page
- noop(): Do nothing

{SEMANTIC_ICL_PROMPT}

Now complete the current task following similar patterns.
"""

# ============================================================
# EVALUATION FUNCTIONS
# ============================================================

def get_agent_action(client, model: str, obs: Dict, system_prompt: str, temperature: float = 0) -> str:
    """Get action from LLM agent."""
    
    user_prompt = f"""
Goal: {obs.get('goal', '')}

Current Observation (Accessibility Tree):
{obs.get('a11y_tree', 'Not available')[:15000]}

Last Action Error: {obs.get('last_action_error', 'None')}

Output the next action:
"""
    
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=temperature,
            max_tokens=150
        )
        action = response.choices[0].message.content.strip()
        
        # Clean markdown
        if action.startswith("```"):
            lines = action.split("\n")
            action = "\n".join(lines[1:-1]) if len(lines) > 2 else action[3:]
        if action.endswith("```"):
            action = action.rsplit("```", 1)[0]
        
        action = action.strip().split("\n")[0].strip()
        return action
    except Exception as e:
        return "noop()"


def run_single_eval(args: Tuple) -> Dict:
    """Run a single evaluation in a separate process."""
    task_id, seed, model_name, temperature, system_prompt, condition, run_id = args
    
    # Initialize OpenAI client in this process
    load_dotenv()
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    result = {
        "model": model_name,
        "seed": seed,
        "condition": condition,
        "success": False,
        "reward": 0.0,
        "steps": 0,
        "time_seconds": 0,
        "error": None,
        "actions": []
    }
    
    env = None
    try:
        print(f"🚀 [{run_id}] Starting: {model_name} | {condition} | seed={seed}")
        
        # Create environment (non-headless for better compatibility)
        env = gym.make(task_id, headless=False)
        obs, info = env.reset(seed=seed)
        
        start_time = time.time()
        
        for step in range(MAX_STEPS):
            elapsed = time.time() - start_time
            if elapsed > TIMEOUT:
                result["error"] = "timeout"
                print(f"    [{run_id}] ⏱️ Timeout")
                break
            
            # Prepare observation
            if 'a11y_tree' not in obs and 'axtree_object' in obs:
                obs['a11y_tree'] = flatten_axtree_to_str(obs['axtree_object'])
            
            # Get action
            action = get_agent_action(client, model_name, obs, system_prompt, temperature)
            result["actions"].append(action)
            
            if step < 3 or step % 5 == 0:
                print(f"    [{run_id}] Step {step+1}: {action[:50]}...")
            
            # Check for repeated actions
            if len(result["actions"]) >= MAX_REPEATED:
                last_n = result["actions"][-MAX_REPEATED:]
                if all(a == last_n[0] for a in last_n):
                    result["error"] = f"repeated {MAX_REPEATED}x"
                    print(f"    [{run_id}] 🔁 Repeated action, failing")
                    break
            
            # Execute action
            try:
                obs, reward, done, truncated, info = env.step(action)
            except Exception as e:
                try:
                    obs, reward, done, truncated, info = env.step("noop()")
                except:
                    result["error"] = "env_error"
                    break
            
            result["steps"] = step + 1
            result["reward"] = reward
            
            if done or truncated:
                result["success"] = reward > 0
                if result["success"]:
                    print(f"    [{run_id}] ✅ SUCCESS!")
                break
        
        result["time_seconds"] = time.time() - start_time
        
    except Exception as e:
        result["error"] = str(e)[:100]
        print(f"    [{run_id}] ❌ Error: {str(e)[:50]}")
    finally:
        if env:
            try:
                env.close()
            except:
                pass
    
    status = "✓" if result["success"] else "✗"
    print(f"✔️ [{run_id}] Done: {status} reward={result['reward']}, steps={result['steps']}")
    
    return result


def run_comparison() -> Dict:
    """Run baseline vs ICL comparison with parallel execution."""
    
    results = {
        "task_id": TASK_ID,
        "timestamp": datetime.now().isoformat(),
        "seeds": SEEDS,
        "models": [m["name"] for m in MODELS],
        "conditions": ["baseline", "icl"],
        "parallel_workers": PARALLEL_WORKERS,
        "evaluations": {
            "baseline": [],
            "icl": []
        },
        "summary": {}
    }
    
    # Build all tasks
    tasks = []
    run_count = 0
    
    for condition in ["baseline", "icl"]:
        system_prompt = BASELINE_SYSTEM_PROMPT if condition == "baseline" else ICL_SYSTEM_PROMPT
        
        for model_config in MODELS:
            model_name = model_config["name"]
            temperature = model_config.get("temp", 0)
            
            for seed in SEEDS:
                run_count += 1
                run_id = f"{run_count:02d}"
                tasks.append((
                    TASK_ID,
                    seed,
                    model_name,
                    temperature,
                    system_prompt,
                    condition,
                    run_id
                ))
    
    total_runs = len(tasks)
    
    print(f"\n{'='*70}")
    print(f"BASELINE vs ICL COMPARISON (PARALLEL - {PARALLEL_WORKERS} workers)")
    print(f"{'='*70}")
    print(f"Task: {TASK_ID}")
    print(f"Models: {[m['name'] for m in MODELS]}")
    print(f"Seeds: {SEEDS}")
    print(f"Total runs: {total_runs}")
    print(f"{'='*70}\n")
    
    # Run tasks in parallel using multiprocessing
    with Pool(processes=PARALLEL_WORKERS) as pool:
        all_results = pool.map(run_single_eval, tasks)
    
    # Organize results by condition
    for result in all_results:
        condition = result["condition"]
        results["evaluations"][condition].append(result)
    
    # Calculate summary statistics
    for condition in ["baseline", "icl"]:
        runs = results["evaluations"][condition]
        results["summary"][condition] = {
            "total_runs": len(runs),
            "successes": sum(1 for r in runs if r["success"]),
            "success_rate": sum(1 for r in runs if r["success"]) / len(runs) if runs else 0,
            "avg_steps": sum(r["steps"] for r in runs) / len(runs) if runs else 0,
            "avg_time": sum(r["time_seconds"] for r in runs) / len(runs) if runs else 0,
            "by_model": {}
        }
        
        for model_config in MODELS:
            model_name = model_config["name"]
            model_runs = [r for r in runs if r["model"] == model_name]
            if model_runs:
                results["summary"][condition]["by_model"][model_name] = {
                    "success_rate": sum(1 for r in model_runs if r["success"]) / len(model_runs),
                    "avg_steps": sum(r["steps"] for r in model_runs) / len(model_runs)
                }
    
    return results


def print_comparison_results(results: Dict):
    """Print comparison results."""
    
    print(f"\n{'='*70}")
    print("📊 BASELINE vs ICL COMPARISON RESULTS")
    print(f"{'='*70}")
    
    print(f"\nTask: {results['task_id']}")
    print(f"Seeds: {results['seeds']}")
    print(f"Models: {results['models']}")
    
    print(f"\n{'─'*70}")
    print("OVERALL COMPARISON")
    print(f"{'─'*70}")
    print(f"{'Condition':<15} {'Success Rate':<15} {'Avg Steps':<12} {'Avg Time':<12}")
    print("-" * 55)
    
    for condition in ["baseline", "icl"]:
        s = results["summary"][condition]
        sr = f"{s['success_rate']*100:.1f}%"
        successes = f"({s['successes']}/{s['total_runs']})"
        steps = f"{s['avg_steps']:.1f}"
        time_s = f"{s['avg_time']:.1f}s"
        print(f"{condition.upper():<15} {sr:<8}{successes:<7} {steps:<12} {time_s:<12}")
    
    print(f"\n{'─'*70}")
    print("BY MODEL")
    print(f"{'─'*70}")
    
    for model_name in results['models']:
        print(f"\n  📌 {model_name}:")
        print(f"    {'Condition':<12} {'Success Rate':<15} {'Avg Steps':<12}")
        print(f"    {'-'*40}")
        
        for condition in ["baseline", "icl"]:
            model_stats = results["summary"][condition]["by_model"].get(model_name, {})
            sr = f"{model_stats.get('success_rate', 0)*100:.1f}%"
            steps = f"{model_stats.get('avg_steps', 0):.1f}"
            print(f"    {condition.upper():<12} {sr:<15} {steps:<12}")
    
    print(f"\n{'─'*70}")
    print("DETAILED RESULTS BY SEED")
    print(f"{'─'*70}")
    
    for condition in ["baseline", "icl"]:
        print(f"\n  📋 {condition.upper()}:")
        for model_name in results['models']:
            print(f"    {model_name}:")
            model_runs = [r for r in results["evaluations"][condition] if r["model"] == model_name]
            for run in sorted(model_runs, key=lambda x: x["seed"]):
                status = "✓" if run["success"] else "✗"
                error = f" ({run['error']})" if run.get('error') else ""
                print(f"      Seed {run['seed']}: {status} reward={run['reward']}, steps={run['steps']}{error}")
    
    baseline_sr = results["summary"]["baseline"]["success_rate"]
    icl_sr = results["summary"]["icl"]["success_rate"]
    improvement = icl_sr - baseline_sr
    
    print(f"\n{'='*70}")
    print(f"📈 ICL IMPROVEMENT: {improvement*100:+.1f}% ({baseline_sr*100:.1f}% → {icl_sr*100:.1f}%)")
    print(f"{'='*70}")


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    print("\n" + "="*70)
    print("STARTING BASELINE vs ICL EVALUATION")
    print("="*70)
    
    results = run_comparison()
    
    results_path = os.path.join(script_dir, f"eval_comparison_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    with open(results_path, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\n💾 Saved results to: {results_path}")
    
    print_comparison_results(results)


if __name__ == "__main__":
    main()
