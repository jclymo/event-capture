# eval_create_hardware_asset.py
# Complete evaluation pipeline for browsergym/workarena.servicenow.create-hardware-asset

import json
import os
import time
import random
from datetime import datetime
from typing import Dict, List, Tuple, Any
from dataclasses import dataclass, asdict, field
import gymnasium as gym
import browsergym.workarena
from openai import OpenAI
from dotenv import load_dotenv
from browsergym.utils.obs import flatten_axtree_to_str

load_dotenv()

# ============================================================
# STEP 1: EXTRACT BGYM ACTIONS FROM TRACE.JSON
# ============================================================

def split_observation_and_event_logs(full_log: List[Dict]) -> Tuple[List[Dict], List[Dict]]:
    """Separate HTML captures from regular events."""
    html_log, event_log = [], []
    for entry in full_log:
        if entry.get('type') == 'htmlCapture':
            html_log.append(entry)
        elif 'target' in entry:
            event_log.append(entry)
    return html_log, event_log


def combine_and_map_events(event_log: List[Dict]) -> List[Dict]:
    """Combines consecutive events on same BID, filters to key events."""
    prev_bids = []
    bid_events = {}
    bid_history = []
    
    for event in event_log:
        if "target" not in event or "bid" not in event["target"]:
            continue
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
                    val = e.get('data', '') or e["target"].get("value", "")
                    if val:
                        data = val  # Use last value
            if data == "":
                continue
            if last_event:
                last_event["final_value"] = data
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


def event_to_bgym_action(event: Dict, step: int) -> Dict:
    """Converts a raw event to BrowserGym action format."""
    tag = event["target"].get("tag", "").upper()
    bid = event["target"]["bid"]
    a11y = event["target"].get("a11y", {})
    
    action_data = {
        "step": step,
        "data_bid": bid,
        "timestamp": event.get("timestamp", 0),
        "url": event.get("url", ""),
        "event_type": event.get("type", ""),
        "element_info": {
            "role": a11y.get("role", ""),
            "name": a11y.get("name", ""),
            "tagName": tag
        }
    }
    
    if tag == "SELECT":
        action_data["action"] = "select_option"
        action_data["option"] = event["target"].get("value", "")
    elif tag in ["INPUT", "TEXTAREA"]:
        action_data["action"] = "fill"
        action_data["value"] = event.get("final_value", "") or event["target"].get("value", "")
    else:
        action_data["action"] = "click"
    
    return action_data


def extract_bgym_actions(trace_path: str) -> Dict:
    """Extract BrowserGym actions from trace.json."""
    print(f"\n📂 Loading trace from: {trace_path}")
    
    with open(trace_path, 'r', encoding='utf-8') as f:
        trace_data = json.load(f)
    
    html_log, event_log = split_observation_and_event_logs(trace_data.get('events', []))
    event_log.sort(key=lambda x: x.get("timestamp", 0))
    
    key_events = combine_and_map_events(event_log)
    
    actions = []
    for i, event in enumerate(key_events):
        action = event_to_bgym_action(event, i + 1)
        actions.append(action)
    
    result = {
        "task_id": trace_data.get("id", ""),
        "task_title": "workarena.servicenow.create-hardware-asset",
        "start_url": trace_data.get("startUrl", ""),
        "end_url": trace_data.get("endUrl", ""),
        "duration_seconds": trace_data.get("durationSeconds", 0),
        "total_actions": len(actions),
        "actions": actions
    }
    
    print(f"✅ Extracted {len(actions)} BrowserGym actions")
    return result


# ============================================================
# STEP 2: GENERATE ICL PROMPT
# ============================================================

def format_action_description(action: Dict) -> str:
    """Format a single action into human-readable description."""
    action_type = action["action"]
    bid = action["data_bid"]
    element = action.get("element_info", {})
    role = element.get("role", "")
    name = element.get("name", "")
    
    if name:
        elem_desc = f'{role} "{name}"' if role else f'"{name}"'
    elif role:
        elem_desc = f'{role} (bid={bid})'
    else:
        elem_desc = f'element (bid={bid})'
    
    if action_type == "click":
        return f"Click on {elem_desc}"
    elif action_type == "fill":
        value = action.get("value", "")
        return f'Type "{value}" into {elem_desc}'
    elif action_type == "select_option":
        option = action.get("option", "")
        return f'Select option "{option}" from {elem_desc}'
    else:
        return f"{action_type} on {elem_desc}"


def generate_action_code(action: Dict) -> str:
    """Generate the BrowserGym action code."""
    action_type = action["action"]
    bid = action["data_bid"]
    
    if action_type == "click":
        return f'click("{bid}")'
    elif action_type == "fill":
        value = action.get("value", "").replace('"', '\\"')
        return f'fill("{bid}", "{value}")'
    elif action_type == "select_option":
        option = action.get("option", "").replace('"', '\\"')
        return f'select_option("{bid}", "{option}")'
    else:
        return f'{action_type}("{bid}")'


def infer_reasoning(action: Dict) -> str:
    """Infer reasoning for an action."""
    element = action.get("element_info", {})
    name = element.get("name", "").lower()
    action_type = action["action"]
    
    if action_type == "fill":
        field_name = name or action.get("data_bid", "")
        return f"Filling in the {field_name} field with required value"
    elif action_type == "select_option":
        return f"Selecting the appropriate option from dropdown"
    elif action_type == "click":
        if "submit" in name or "save" in name or "insert" in name:
            return "Submitting the form to create the record"
        elif "model" in name or "category" in name:
            return "Selecting from lookup field"
        else:
            return "Clicking to interact with element"
    return ""


def generate_icl_prompt(bgym_data: Dict) -> str:
    """Generate ICL prompt from BrowserGym actions."""
    actions = bgym_data.get("actions", [])
    total_actions = len(actions)
    
    prompt_parts = []
    
    prompt_parts.append("=" * 60)
    prompt_parts.append("HUMAN DEMONSTRATION - CREATE HARDWARE ASSET")
    prompt_parts.append("=" * 60)
    prompt_parts.append("")
    
    prompt_parts.append("## TASK OVERVIEW")
    prompt_parts.append("Task: Create Hardware Asset")
    prompt_parts.append("Task ID: workarena.servicenow.create-hardware-asset")
    prompt_parts.append(f"Starting URL: {bgym_data.get('start_url', '')}")
    prompt_parts.append(f"Total Steps: {total_actions}")
    prompt_parts.append("")
    
    prompt_parts.append("## GOAL")
    prompt_parts.append("Create a new hardware asset record by filling out the form with required field values.")
    prompt_parts.append("")
    
    prompt_parts.append("## STEP-BY-STEP DEMONSTRATION")
    prompt_parts.append("")
    
    for action in actions:
        prompt_parts.append(f"### Step {action['step']}/{total_actions}")
        prompt_parts.append(f"**Action:** {format_action_description(action)}")
        prompt_parts.append(f"**Code:** `{generate_action_code(action)}`")
        
        elem = action.get("element_info", {})
        if elem.get("role") or elem.get("name"):
            prompt_parts.append(f"**Element:** role=\"{elem.get('role', '')}\", name=\"{elem.get('name', '')}\"")
        
        reasoning = infer_reasoning(action)
        if reasoning:
            prompt_parts.append(f"**Why:** {reasoning}")
        
        prompt_parts.append("")
    
    prompt_parts.append("## KEY PATTERNS")
    prompt_parts.append("- **Form Filling:** Fill input fields with required values")
    prompt_parts.append("- **Lookup Fields:** Click reference fields, type to search, select from dropdown")
    prompt_parts.append("- **Submit:** Click 'Submit' or 'Insert' button to create record")
    prompt_parts.append("")
    prompt_parts.append("## HOW TO USE THIS DEMONSTRATION")
    prompt_parts.append("1. Identify input fields by their role and name")
    prompt_parts.append("2. Fill fields with the values from the goal")
    prompt_parts.append("3. For reference/lookup fields, type the value and select from dropdown")
    prompt_parts.append("4. Click Submit to create the record")
    prompt_parts.append("")
    prompt_parts.append("=" * 60)
    
    return "\n".join(prompt_parts)


# ============================================================
# STEP 3: AGENT WITH ICL
# ============================================================

def get_agent_action(client, model: str, obs: Dict, icl_prompt: str, temperature: float = 0) -> str:
    """Get action from LLM agent."""
    
    system_prompt = f"""You are an AI agent controlling a web browser to complete a task.
You will receive the current goal, the current observation (accessibility tree).
Your goal is to complete the task efficiently.

Output ONLY the code for the next action to execute. Do not output markdown blocks or explanations.
Example: click('123') or fill('456', 'some value')
Make sure the input params are in quotes.

Available actions:
- click(bid): Click on element with given browsergym ID
- fill(bid, text): Type text into input element  
- select_option(bid, option): Select option from dropdown
- scroll(x, y): Scroll the page
- noop(): Do nothing

{icl_prompt}

Now complete the current task following similar patterns.
"""

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
            max_tokens=100
        )
        action = response.choices[0].message.content.strip()
        
        # Clean markdown
        if action.startswith("```"):
            action = action.split("\n", 1)[1] if "\n" in action else action[3:]
        if action.endswith("```"):
            action = action.rsplit("```", 1)[0]
        
        return action.strip()
    except Exception as e:
        print(f"Agent error: {e}")
        return "noop()"


# ============================================================
# STEP 4: EVALUATION RUNNER
# ============================================================

@dataclass
class EvalResult:
    model: str
    seed: int
    success: bool
    reward: float
    steps: int
    time_seconds: float
    error: str = None
    actions: List[str] = field(default_factory=list)


def run_single_eval(
    task_id: str,
    seed: int,
    model: str,
    client: OpenAI,
    icl_prompt: str,
    max_steps: int = 50,
    timeout: int = 120,  # 2 minute timeout
    temperature: float = 0,
    max_repeated_actions: int = 5  # Fail if same action repeated 5 times
) -> EvalResult:
    """Run a single evaluation."""
    
    result = EvalResult(
        model=model,
        seed=seed,
        success=False,
        reward=0.0,
        steps=0,
        time_seconds=0,
        actions=[]
    )
    
    try:
        env = gym.make(task_id, headless=False)
        obs, info = env.reset(seed=seed)
        
        start_time = time.time()
        reward = 0
        done = False
        
        for step in range(max_steps):
            elapsed = time.time() - start_time
            if elapsed > timeout:
                result.error = "timeout (2 min)"
                print(f"    ⏱️ Timeout reached (2 minutes)")
                break
            
            # Prepare observation
            if 'a11y_tree' not in obs and 'axtree_object' in obs:
                obs['a11y_tree'] = flatten_axtree_to_str(obs['axtree_object'])
            
            # Get action
            action = get_agent_action(client, model, obs, icl_prompt, temperature)
            result.actions.append(action)
            
            print(f"    Step {step+1}: {action[:50]}...")
            
            # Check for repeated actions (5 consecutive same actions = fail)
            if len(result.actions) >= max_repeated_actions:
                last_n = result.actions[-max_repeated_actions:]
                if all(a == last_n[0] for a in last_n):
                    result.error = f"repeated action {max_repeated_actions}x: {action[:30]}"
                    print(f"    🔁 Same action repeated {max_repeated_actions} times, failing...")
                    break
            
            # Execute
            try:
                obs, reward, done, truncated, info = env.step(action)
            except Exception as e:
                print(f"    Execution error: {e}")
                obs, reward, done, truncated, info = env.step("noop()")
            
            result.steps = step + 1
            result.reward = reward
            
            if done or truncated:
                result.success = reward > 0
                break
        
        result.time_seconds = time.time() - start_time
        
    except Exception as e:
        result.error = str(e)
        print(f"    Error: {e}")
    finally:
        try:
            env.close()
        except:
            pass
    
    return result


def run_full_evaluation(
    task_id: str,
    icl_prompt: str,
    models: List[Dict],  # [{"name": "gpt-4", "temp": 0}, ...]
    seeds: List[int],
    client: OpenAI
) -> Dict:
    """Run full evaluation across models and seeds."""
    
    results = {
        "task_id": task_id,
        "timestamp": datetime.now().isoformat(),
        "seeds": seeds,
        "models": [m["name"] for m in models],
        "evaluations": [],
        "summary": {}
    }
    
    total_runs = len(models) * len(seeds)
    run_count = 0
    
    print(f"\n{'='*60}")
    print(f"EVALUATION: {task_id}")
    print(f"Models: {[m['name'] for m in models]}")
    print(f"Seeds: {seeds}")
    print(f"Total runs: {total_runs}")
    print(f"{'='*60}\n")
    
    for model_config in models:
        model_name = model_config["name"]
        temperature = model_config.get("temp", 0)
        
        model_results = {
            "model": model_name,
            "temperature": temperature,
            "runs": [],
            "success_rate": 0,
            "avg_steps": 0,
            "avg_time": 0
        }
        
        for seed in seeds:
            run_count += 1
            print(f"[{run_count}/{total_runs}] {model_name} (seed={seed}, temp={temperature})...")
            
            eval_result = run_single_eval(
                task_id=task_id,
                seed=seed,
                model=model_name,
                client=client,
                icl_prompt=icl_prompt,
                temperature=temperature
            )
            
            status = "✓" if eval_result.success else "✗"
            print(f"    Result: {status} (reward={eval_result.reward}, steps={eval_result.steps})\n")
            
            model_results["runs"].append(asdict(eval_result))
        
        # Calculate model stats
        runs = model_results["runs"]
        model_results["success_rate"] = sum(1 for r in runs if r["success"]) / len(runs)
        model_results["avg_steps"] = sum(r["steps"] for r in runs) / len(runs)
        model_results["avg_time"] = sum(r["time_seconds"] for r in runs) / len(runs)
        
        results["evaluations"].append(model_results)
    
    # Overall summary
    all_runs = [r for m in results["evaluations"] for r in m["runs"]]
    results["summary"] = {
        "total_runs": len(all_runs),
        "total_successes": sum(1 for r in all_runs if r["success"]),
        "overall_success_rate": sum(1 for r in all_runs if r["success"]) / len(all_runs) if all_runs else 0
    }
    
    return results


def print_results(results: Dict):
    """Print evaluation results."""
    
    print(f"\n{'='*60}")
    print("EVALUATION RESULTS")
    print(f"{'='*60}")
    
    print(f"\nTask: {results['task_id']}")
    print(f"Seeds: {results['seeds']}")
    
    print(f"\n{'Model':<20} {'Success Rate':<15} {'Avg Steps':<12} {'Avg Time':<12}")
    print("-" * 60)
    
    for model_result in results["evaluations"]:
        model = model_result["model"]
        sr = f"{model_result['success_rate']*100:.1f}%"
        steps = f"{model_result['avg_steps']:.1f}"
        time_s = f"{model_result['avg_time']:.1f}s"
        print(f"{model:<20} {sr:<15} {steps:<12} {time_s:<12}")
    
    print("-" * 60)
    summary = results["summary"]
    print(f"{'TOTAL':<20} {summary['overall_success_rate']*100:.1f}% ({summary['total_successes']}/{summary['total_runs']})")
    
    print(f"\n📊 Detailed Results by Seed:")
    for model_result in results["evaluations"]:
        print(f"\n  {model_result['model']}:")
        for run in model_result["runs"]:
            status = "✓" if run["success"] else "✗"
            print(f"    Seed {run['seed']}: {status} reward={run['reward']}, steps={run['steps']}")


# ============================================================
# MAIN
# ============================================================

def main():
    # Configuration - use absolute path based on script location
    script_dir = os.path.dirname(os.path.abspath(__file__))
    TRACE_PATH = os.path.join(script_dir, "form_trace", "trace.json")
    TASK_ID = "browsergym/workarena.servicenow.create-hardware-asset"
    
    # 5 random seeds (not 42)
    random.seed(123)  # For reproducibility
    SEEDS = random.sample([i for i in range(1, 1000) if i != 42], 5)
    print(f"Selected seeds: {SEEDS}")
    
    # Models to test - using available models
    MODELS = [
        {"name": "gpt-4o", "temp": 0},
        {"name": "gpt-4o-mini", "temp": 0},
        # {"name": "gpt-4.5-preview", "temp": 1},  # Uncomment if available
    ]
    
    # Initialize OpenAI client
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    # Step 1: Extract BrowserGym actions
    print("\n" + "="*60)
    print("STEP 1: EXTRACTING BROWSERGYM ACTIONS")
    print("="*60)
    bgym_data = extract_bgym_actions(TRACE_PATH)
    
    # Save extracted actions
    actions_path = os.path.join(script_dir, "form_trace_bgym_actions.json")
    with open(actions_path, 'w') as f:
        json.dump(bgym_data, f, indent=2)
    print(f"Saved to: {actions_path}")
    
    # Print extracted actions summary
    print(f"\nExtracted Actions ({len(bgym_data['actions'])} total):")
    for action in bgym_data['actions'][:10]:  # Show first 10
        name = action['element_info'].get('name', '')[:30]
        print(f"  {action['step']}. {action['action']}('{action['data_bid']}') - {name}")
    if len(bgym_data['actions']) > 10:
        print(f"  ... and {len(bgym_data['actions']) - 10} more")
    
    # Step 2: Generate ICL prompt
    print("\n" + "="*60)
    print("STEP 2: GENERATING ICL PROMPT")
    print("="*60)
    icl_prompt = generate_icl_prompt(bgym_data)
    
    prompt_path = os.path.join(script_dir, "create_hardware_asset_icl_prompt.txt")
    with open(prompt_path, 'w') as f:
        f.write(icl_prompt)
    print(f"Saved ICL prompt to: {prompt_path}")
    print(f"Prompt length: {len(icl_prompt)} characters")
    
    # Step 3: Run evaluation
    print("\n" + "="*60)
    print("STEP 3: RUNNING EVALUATION")
    print("="*60)
    
    results = run_full_evaluation(
        task_id=TASK_ID,
        icl_prompt=icl_prompt,
        models=MODELS,
        seeds=SEEDS,
        client=client
    )
    
    # Save results
    results_path = os.path.join(script_dir, f"eval_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    with open(results_path, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved results to: {results_path}")
    
    # Print summary
    print_results(results)


if __name__ == "__main__":
    main()

