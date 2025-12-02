import gymnasium as gym
import browsergym.workarena
import time
import sys
import os
from dotenv import load_dotenv

load_dotenv()

def main():
    task_file = "task.txt"
    if not os.path.exists(task_file):
        print(f"Error: {task_file} not found.")
        return

    with open(task_file, "r") as f:
        lines = [line.strip() for line in f.readlines() if line.strip()]

    if not lines:
        print("Error: task.txt is empty.")
        return

    task_id = lines[0]
    actions = lines[1:]

    print(f"Task ID: {task_id}")
    print(f"Loaded {len(actions)} actions.")

    try:
        env = gym.make(task_id, headless=False)
        obs, info = env.reset()
        print("Environment initialized and reset.")
        
        # Initial wait to let page load
        time.sleep(2)

        for i, action in enumerate(actions):
            print(f"[{i+1}/{len(actions)}] Executing: {action}")
            
            try:
                obs, reward, done, truncated, info = env.step(action)
                print(f"  Action completed. Done: {done}")
                
                if done:
                    print("Task completed by environment.")
                    break
            except Exception as e:
                print(f"  Error executing action: {e}")
            
            time.sleep(1)

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        if 'env' in locals():
            env.close()
            print("Environment closed.")

if __name__ == "__main__":
    main()
