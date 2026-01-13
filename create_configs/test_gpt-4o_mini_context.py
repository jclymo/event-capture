import gymnasium as gym
import browsergym.workarena
import os
import time
import json
import numpy as np
from openai import OpenAI
from dotenv import load_dotenv
from browsergym.utils.obs import flatten_axtree_to_str

load_dotenv()


def build_visible_elements_summary(axtree, max_elems=80):
    """
    Returns a compact text list:
    bid | role | name | visible | bbox
    for (up to) max_elems elements.
    """
    lines = []

    def visit(node):
        if not isinstance(node, dict):
            return
        bid = node.get("bid")
        role = node.get("role")
        name = node.get("name") or node.get("inner_text") or ""
        visible = node.get("visible")
        bbox = node.get("bbox")

        if bid is not None and role is not None:
            lines.append(
                f"bid={bid} | role={role} | name={name[:80]} | visible={visible} | bbox={bbox}"
            )

        for child in node.get("children") or []:
            visit(child)

    visit(axtree)
    return "\n".join(lines[:max_elems])


def get_gpt_action(client, obs, available_actions):
    """
    Asks the model for the next action based on the observation and available actions.
    """
    system_prompt = """
You are an AI agent controlling a web browser to complete a task.
You will receive the current goal, a compact list of visible elements, the accessibility tree, and a list of available actions.
Your goal is to complete the task efficiently.
Output ONLY the code for the next action to execute. Do not output markdown blocks or explanations.
Examples: click("a123"), fill("a45", "foo"), select_option("a9", "High").
All string parameters must be in double quotes.
"""

    user_prompt = f"""
Goal:
{obs.get('goal', 'Not available')}

Available BrowserGym Actions:
{available_actions}

Visible elements (compact list):
{obs.get('visible_elements_summary', 'Not available')}

Current Observation (Accessibility Tree - flattened):
{obs.get('a11y_tree', 'Not available')}

Last Action Errors:
{obs.get('last_action_error', 'None')}
"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=1,
            max_tokens=128000,
        )
        action = response.choices[0].message.content.strip()
        if action.startswith("```"):
            action = action.split("\n", 1)[1]
        if action.endswith("```"):
            action = action.rsplit("\n", 1)[0]
        return action.strip()
    except Exception as e:
        print(f"Error getting action from model: {e}")
        return 'noop()'


class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super(NumpyEncoder, self).default(obj)


def main():
    TASK_ID = "browsergym/workarena.servicenow.filter-incident-list"
    SEED = 42
    TIMEOUT_SECONDS = 300

    print(f"Starting task: {TASK_ID}")
    print(f"Seed: {SEED}")
    print(f"Timeout: {TIMEOUT_SECONDS} seconds")

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY not found in environment variables.")
        return

    client = OpenAI(api_key=api_key)

    try:
        env = gym.make(TASK_ID, headless=False)
    except Exception as e:
        print(f"Error initializing environment: {e}")
        print(f"Make sure browsergym-workarena is installed and the task ID '{TASK_ID}' is correct.")
        return

    obs, info = env.reset(seed=SEED)
    print("Environment initialized and reset.")
    print("Obs keys at reset:", list(obs.keys()))

    start_time = time.time()
    step_count = 0

    b_gym_actions_desc = """
- click(bid): Click on an element with the given bid.
- fill(bid, text): Type text into an element with the given bid.
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
            elapsed_time = time.time() - start_time
            if elapsed_time > TIMEOUT_SECONDS:
                print(f"Timeout reached ({TIMEOUT_SECONDS}s). Stopping.")
                break

            # Build a11y_tree (flattened) if possible
            if "a11y_tree" not in obs:
                axtree = obs.get("axtree_object", None)
                if axtree is None:
                    if step_count == 0:
                        print("Warning: 'axtree_object' not found. No accessibility tree available.")
                    obs["a11y_tree"] = "Not available"
                else:
                    try:
                        obs["a11y_tree"] = flatten_axtree_to_str(axtree)
                    except Exception as e:
                        print(f"Error flattening axtree: {e}")
                        obs["a11y_tree"] = "Error flattening axtree."

            # Build compact visible elements summary
            axtree = obs.get("axtree_object", None)
            if axtree is not None:
                try:
                    obs["visible_elements_summary"] = build_visible_elements_summary(axtree, max_elems=80)
                except Exception as e:
                    print(f"Error building visible_elements_summary: {e}")
                    obs["visible_elements_summary"] = "Error building visible elements summary."
            else:
                obs["visible_elements_summary"] = "Not available"

            # Remove screenshot from dump to save space
            if "screenshot" in obs:
                del obs["screenshot"]

            with open("obs.json", "w") as f:
                json.dump(obs, f, indent=2, cls=NumpyEncoder)

            print(f"\nStep {step_count + 1} (Elapsed: {elapsed_time:.1f}s)")

            action = get_gpt_action(client, obs, b_gym_actions_desc)
            print(f"Agent Action: {action}")

            try:
                obs, reward, done, truncated, info = env.step(action)
            except Exception as e:
                print(f"Execution Error: {e}")
                obs, reward, done, truncated, info = env.step("noop()")

            print(f"Reward: {reward}, Done: {done}, Truncated: {truncated}")

            if done or truncated:
                print("Episode finished.")
                break

            step_count += 1
            time.sleep(1)

    except KeyboardInterrupt:
        print("\nInterrupted by user.")
    finally:
        env.close()
        print("Environment closed.")


if __name__ == "__main__":
    main()
