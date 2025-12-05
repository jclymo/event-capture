# -*- coding: utf-8 -*-
from dotenv import load_dotenv
import logging
import logging
import json
logging.basicConfig(level=logging.INFO)
load_dotenv()
import gymnasium as gym
import browsergym.workarena
import time
from playwright.sync_api import TimeoutError as PlaywrightTimeout



tasks=[
    "browsergym/workarena.servicenow.knowledge-base-search",
"browsergym/workarena.servicenow.order-standard-laptop",
"browsergym/workarena.servicenow.sort-change-request-list",
"browsergym/workarena.servicenow.create-hardware-asset",
"browsergym/workarena.servicenow.filter-incident-list",
"browsergym/workarena.servicenow.sort-hardware-list",
"browsergym/workarena.servicenow.multi-chart-value-retrieval",
"browsergym/workarena.servicenow.single-chart-min-max-retrieval",
"browsergym/workarena.servicenow.all-menu",
"browsergym/workarena.servicenow.filter-user-list",
"browsergym/workarena.servicenow.create-user",
"browsergym/workarena.servicenow.sort-service-catalog-item-list",
"browsergym/workarena.servicenow.filter-hardware-list",
"browsergym/workarena.servicenow.sort-asset-list",
"browsergym/workarena.servicenow.order-apple-watch",
"browsergym/workarena.servicenow.create-change-request",
"browsergym/workarena.servicenow.filter-service-catalog-item-list",
"browsergym/workarena.servicenow.sort-user-list",
"browsergym/workarena.servicenow.multi-chart-min-max-retrieval",
"browsergym/workarena.servicenow.create-problem",
"browsergym/workarena.servicenow.sort-incident-list",
"browsergym/workarena.servicenow.order-ipad-pro",
"browsergym/workarena.servicenow.order-sales-laptop",
"browsergym/workarena.servicenow.order-apple-mac-book-pro15",
"browsergym/workarena.servicenow.order-loaner-laptop",
"browsergym/workarena.servicenow.create-incident",
"browsergym/workarena.servicenow.filter-asset-list",
"browsergym/workarena.servicenow.impersonation",
"browsergym/workarena.servicenow.single-chart-value-retrieval",
"browsergym/workarena.servicenow.order-development-laptop-p-c",
"browsergym/workarena.servicenow.order-ipad-mini",
"browsergym/workarena.servicenow.filter-change-request-list",
"browsergym/workarena.servicenow.order-developer-laptop"
]

seed = 42


def execute_action_from_json(page, action):
    """Execute a single action from the JSON format"""
    action_type = action.get('action', '')
    selector = action.get('selector', '')
    field_value = action.get('field_value', '')
    xpath = action.get('xpath', '')
    
    print(f"  Executing: {action_type} on {selector}")
    
    try:
        if action_type == 'wait_for_selector':
            # Wait for element to be visible
            element = page.wait_for_selector(selector, timeout=30000)
            print(f"    Γ£ô Element found: {selector}")
            return element
            
        elif action_type == 'click':
            # Click the element using the selector
            page.click(selector, timeout=30000)
            print(f"    Γ£ô Clicked: {selector}")
            
        elif action_type == 'select_option':
            # Select option from dropdown
            if field_value:
                page.select_option(selector, value=field_value, timeout=30000)
                print(f"    Γ£ô Selected option: {field_value}")
            else:
                print(f"    ΓÜá No value to select")
                
        elif action_type == 'fill':
            # Fill input field
            page.fill(selector, field_value, timeout=30000)
            print(f"    Γ£ô Filled: {field_value}")
            
        else:
            print(f"    ΓÜá Unknown action type: {action_type}")
            
    except PlaywrightTimeout as e:
        print(f"    Γ£ù Timeout: {e}")
        return None
    except Exception as e:
        print(f"    Γ£ù Error: {e}")
        return None


def replay_from_json(task_id, json_path='playwright_actions.json'):
    """Replay actions from JSON file in the environment"""
    
    # Load actions from JSON
    try:
        with open(json_path, 'r') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Error: {json_path} not found. Run cheat first to generate it.")
        return
    
    start_url = data.get('start_url', '')
    actions = data.get('actions', [])
    
    print(f"Loaded {len(actions)} actions from {json_path}")
    print(f"Start URL: {start_url}")
    
    # Create environment
    env = gym.make(task_id, headless=False)
    
    obs, info = env.reset(seed=seed)
    
    task_message = info.get('goal', '') or info.get('message', '')
    print(f"\nTask Goal: {task_message}\n")
    
    page = env.unwrapped.page
    
    # Navigate to start URL if available
    if start_url:
        print(f"Navigating to: {start_url}")
        page.goto(start_url)
        page.wait_for_load_state('networkidle')
    
    # Execute each action
    print("\n" + "="*80)
    print("EXECUTING ACTIONS")
    print("="*80)
    
    for i, action in enumerate(actions, 1):
        print(f"\nStep {i}/{len(actions)}:")
        execute_action_from_json(page, action)
        
        # Small delay between actions for stability
        page.wait_for_timeout(500)
    
    print("\n" + "="*80)
    print("REPLAY COMPLETE")
    print("="*80)
    
    # Validate the result
    task = env.unwrapped.task
    cheat_messages = []
    
    try:
        reward, done, message, validation_info = task.validate(page, cheat_messages)
        print(f"\nTask completed: {done}")
        print(f"Reward: {reward}")
        print(f"Message: {message}")
    except Exception as e:
        print(f"\nValidation error: {e}")
    
    # Keep browser open for inspection
    input("\nPress Enter to close browser...")
    
    env.close()
    
    return task_message


def cheat_and_record(task_id, iter):
    """Original cheat function to generate trace and JSON"""
    global seed
    
    # Create environment
    trace_path = "trace.zip"
    env = gym.make(task_id, headless=False)
    
    obs, info = env.reset(seed=seed)
    trace_path = trace_path.replace(".zip", f"_iter_{iter}.zip")
    
    task_message = info.get('goal', '') or info.get('message', '')
    # Check if task has config attribute

    # with open("env_info.json", "w") as f:
    #     f.write(json.dumps(env.unwrapped.info, indent=4))
    print(str(env.unwrapped.task))
    with open("browsergym_info.json", "w") as f:
        f.write(json.dumps({"task":str(env.unwrapped.task),}, indent=4))
        f.write(json.dumps({"start_time": time.time(),}, indent=4))
        f.write(json.dumps({"task_message": task_message,}, indent=4))
        f.write(json.dumps({"seed": seed,}, indent=4))
    task_message = info.get('goal', '') or info.get('message', '')
    print(f"\nTask Goal: {info.values()}\n")
    task = env.unwrapped.task
    page = env.unwrapped.page
    if hasattr(task, 'config') and task.config:
        task_message = task.config.get('goal', '')
        print(f"Goal from config: {task_message}")
    if hasattr(task, 'get_pretty_printed_description'):
        task_message = task.get_pretty_printed_description()
        print(f"Task description: {task_message}")
    print(f"Task: {str(task)}")
    print(f"Task ID: {task_id}")
    print(f"Seed: {seed}")
    print("Start_URL: ", page.url)
    print("Start_Time: ", time.time())
    
    # Start tracing before cheat execution
    context = page.context
    context.tracing.start(screenshots=True, snapshots=True, sources=True)
    
    cheat_messages = []
    task.cheat(page, cheat_messages)
    
    # Stop tracing and save to file
    context.tracing.stop(path=trace_path)
    
    
    print(f"Cheat messages: {cheat_messages}")
    
    reward, done, message, validation_info = task.validate(page, cheat_messages)
    message = message or "Task completed successfully"
    print(f"Message: {message}")
    print("End_URL: ", page.url)
    print("End_Time: ", time.time())
    print(f"Task completed: {done}")
    print(f"Reward: {reward}")
    with open("browsergym_info.json", "w") as f:
        # f.write(json.dumps({"task":str(env.unwrapped.task),}, indent=4))
        f.write(json.dumps({"end_time": time.time(),}, indent=4))
    env.close()
    
    print("\nΓ£ô Saved trace.zip")
    print("Run: python parse_trace.py to generate playwright_actions.json")
    
    return task_message


# Main execution
if __name__ == '__main__':
    import sys
    
    mode = 'cheat'
    
    for iter, task in enumerate(tasks):
        print(f"\n{'='*80}")
        print(f"TASK {iter+1}: {task}")
        print(f"{'='*80}\n")
        
        if mode == 'cheat':
            # Mode 1: Run cheat to generate trace
            print("Mode: CHEAT (Recording actions)")
            cheat_and_record(task, iter)
            
        elif mode == 'replay':
            # Mode 2: Replay from JSON
            print("Mode: REPLAY (Executing from JSON)")
            replay_from_json(task)
            
        else:
            print(f"Unknown mode: {mode}")
            print("Usage: python script.py [cheat|replay]")
            break
