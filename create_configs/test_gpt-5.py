import gymnasium as gym
import browsergym.workarena
import sys
import os
import time
import json
from openai import OpenAI
from dotenv import load_dotenv
from browsergym.utils.obs import flatten_axtree_to_str

load_dotenv()

def get_gpt4o_mini_action(client, obs, available_actions):
    """
    Asks GPT-4o-mini for the next action based on the observation and available actions.
    """
    # Construct the prompt
    system_prompt = """
You are an AI agent controlling a web browser to complete a task.
You will receive the current goal, the current observation (accessibility tree), and a list of available actions.
Your goal is to complete the task efficiently.
Output ONLY the code for the next action to execute. Do not output markdown blocks or explanations.
Example: click('123')
make sure the input params are in quotes.
"""

    user_prompt = f"""
Goal: {obs['goal']}

Available BrowserGym Actions:
{available_actions}

Current Observation (Accessibility Tree):
{obs.get('a11y_tree', 'Not available')}

Last Action Errors: {obs.get('last_action_error', 'None')}


NOTE : start with click("a47")
general filter task:    
    click(bid of elem with filter image)
   select_option(bid of element with select tags,value)
   click(bid of input tag) <-> click("a47")
   fill(bid of input tag,value)
   click(bid of correct value tag)

"""

    try:
        response = client.chat.completions.create(
            model="gpt-5",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=1,
            # max_tokens=100000
        )
        action = response.choices[0].message.content.strip()
        # Remove markdown code blocks if present
        if action.startswith("```"):
            action = action.split("\n", 1)[1]
        if action.endswith("```"):
            action = action.rsplit("\n", 1)[0]
        ## replace number 47 with 47 in actisoin string
        return action.strip()
    except Exception as e:
        print(f"Error getting action from GPT-4o-mini: {e}")
        return "noop()"

def main():
    # Configuration
    TASK_ID = "browsergym/workarena.servicenow.filter-incident-list"
    SEED = 42
    TIMEOUT_SECONDS = 300  # 5 minutes
    
    print(f"Starting task: {TASK_ID}")
    print(f"Seed: {SEED}")
    print(f"Timeout: {TIMEOUT_SECONDS} seconds")

    # Initialize OpenAI client
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY not found in environment variables.")
        return
    
    client = OpenAI(api_key=api_key)

    # Initialize Environment
    try:
        env = gym.make(TASK_ID, headless=False)
    except Exception as e:
        print(f"Error initializing environment: {e}")
        print(f"Make sure browsergym-workarena is installed and the task ID '{TASK_ID}' is correct.")
        return

    obs, info = env.reset(seed=SEED)
    print("Environment initialized and reset.")
    
    start_time = time.time()
    step_count = 0

    # Define available actions description (BGym actions)
    b_gym_actions_desc = """
    - click(bid): Click on an element with the given bid.
    - type(bid, text): Type text into an element with the given bid.
    - select_option(bid, option): Select an option in a dropdown.
    - scroll(x, y): Scroll the page.
    - hover(bid): Hover over an element.
    - noop(): Do nothing.
    - go_back(): Navigate back.
    - go_forward(): Navigate forward.
    - goto(url): Navigate to a URL.
    """

    try:
        while True:
            # Check timeout
            elapsed_time = time.time() - start_time
            if elapsed_time > TIMEOUT_SECONDS:
                print(f"Timeout reached ({TIMEOUT_SECONDS}s). Stopping.")
                break

            # Handle missing a11y_tree by using flatten_axtree_to_str
            if 'a11y_tree' not in obs:
                if 'axtree_object' in obs:
                    try:
                        obs['a11y_tree'] = flatten_axtree_to_str(obs['axtree_object'])
                    except Exception as e:
                        print(f"Error flattening axtree: {e}")
                        obs['a11y_tree'] = "Error flattening axtree."
                else:
                    obs['a11y_tree'] = "Not available"
                    if step_count == 0:
                        print("Warning: 'a11y_tree' and 'axtree_object' not found. Agent is blind.")
            # Save obs to json for debugging (handle numpy arrays)
            import numpy as np
            class NumpyEncoder(json.JSONEncoder):
                def default(self, obj):
                    if isinstance(obj, np.ndarray):
                        return obj.tolist()
                    return super(NumpyEncoder, self).default(obj)

            # Remove screenshot to save space
            if 'screenshot' in obs:
                del obs['screenshot']

            with open("obs.json", "w") as f:
                json.dump(obs, f, indent=2, cls=NumpyEncoder)

            print(f"\nStep {step_count + 1} (Elapsed: {elapsed_time:.1f}s)")
            
            # Get action from agent
            action = get_gpt4o_mini_action(client, obs, b_gym_actions_desc)
            print(f"Agent Action: {action}")

            # Execute action
            try:
                obs, reward, done, truncated, info = env.step(action)
            except Exception as e:
                print(f"Execution Error: {e}")
                obs, reward, done, truncated, info = env.step("noop()") # Try to recover

            print(f"Reward: {reward}, Done: {done}")

            if done:
                print("Task completed!")
                break
            
            step_count += 1
            time.sleep(1) # Small pause for visibility

    except KeyboardInterrupt:
        print("\nInterrupted by user.")
    finally:
        env.close()
        print("Environment closed.")

if __name__ == "__main__":
    main()
