from openai import OpenAI
from dotenv import load_dotenv
import json

load_dotenv()

axtree_data_augmentation_prompt = (
    """
I will provide you an accessibility tree, original task, and correct response. Your job is to generate a response based on the same accessibility, but with a different task. 

You need to generate a JSON object inside """
    """. The object has two key "element" and "action". 
1. Element: the element's nodeId 
2. Action: an action within action space defined below. 

Action Space: 
- ˋclickˋ: This action clicks on an element with a specific id on the webpage. 
- ˋtype [content] [press_enter_after=0|1]ˋ: Use this to type the content into the field. By default, the "Enter" key is pressed after typing unless press_enter_after is set to 0. 
- ˋhoverˋ: Hover over an element. 
- ˋpress [key_comb]ˋ: Simulates the pressing of a key combination on the keyboard (e.g., Ctrl+v). 
- ˋscroll [down/up]ˋ: Scroll the page up or down. You need to output the command like scroll [down] to scroll down. 
- ˋnew_tabˋ: Open a new, empty browser tab. 
- ˋtab_focus [tab_index]ˋ: Switch the browser's focus to a specific tab using its index. 
- ˋclose_tabˋ: Close the currently active tab. 
- ˋgoto [url]ˋ: Navigate to a specific URL. 
- ˋgo_backˋ: Navigate to the previously viewed page. 
- ˋgo_forwardˋ: Navigate to the next page (if a previous 'go_back' action was performed). 
- ˋstop [answer]ˋ: Issue this action when you believe the task is complete. If the objective is to find a text-based answer, provide the answer in the bracket. If you believe the task is impossible to complete, provide the answer as "N/A" in the bracket. 

Example response """
)
{"element": "11", "action": "click"}
""" 

The original task is "{original_task}". 
The response is """
{"element": "{bid}", "action": "{action}", "value": "{value}"}
""" 

Now, generate a response with new task "{new_task}".
"""


def make_prediction(
    filename: str,
    original_task: str,
    new_task: str,
    correct_bid: int,
    correct_action: str,
    correct_value="",
):
    client = OpenAI()
    filepath = "axtree/" + filename.replace(".html", ".json")
    # Read the accessibility tree JSON and inline it into the prompt
    # with open(filepath, "r") as f:
    #     axtree_json = json.load(f)
    # axtree_text = json.dumps(axtree_json, separators=(",", ":"))

    file = client.files.create(file=open(filepath, "rb"), purpose="assistants")

    user_prompt = axtree_data_augmentation_prompt.format(
        original_task=original_task,
        bid=correct_bid,
        action=correct_action,
        value=correct_value,
        new_task=new_task,
    )
    # print(user_prompt)
    # Use Responses API with file_search to attach large JSON via file_id
    run = client.responses.create(
        model="gpt-5",
        input=[
            {
                "role": "user",
                "content": [{"type": "input_text", "text": user_prompt}],
                "attachments": [
                    {"file_id": file.id, "tools": [{"type": "file_search"}]}
                ],
            }
        ],
        tools=[{"type": "file_search"}],
    )

    # Prefer output_text if available; fallback to first text chunk
    output_text = getattr(run, "output_text", None)
    if output_text is None:
        try:
            output_text = run.output[0].content[0].text
        except Exception:
            output_text = str(run)
    print(output_text)


make_prediction(
    "apple.html",
    "Go to all iPhone page, buy an unlocked iPhone 17, select random color and the cheapest spec with no trade-in and pay full amount. No insurance",
    "Go to all iPad page, buy an iPad Air, select random color and the cheapest spec with no trade-in and pay full amount. No insurance",
    702,
    "click",
)
