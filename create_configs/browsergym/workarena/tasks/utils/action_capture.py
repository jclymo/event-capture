"""
Utility functions for capturing browser actions and injecting monitoring scripts.
"""

import json
import time
from pathlib import Path
from playwright.sync_api import Page, Locator


def inject_bgym_actions(page: Page):
    """Inject browsergym-inject.js into the whole page (main page + all iframes)"""
    browsergym_script_path = Path(r"C:\Users\karth_2bwktag\Desktop\GITHUB\CAPSTONE\EXTENSION\event-capture\extension\browsergym-inject.js")
    if browsergym_script_path.exists():
        try:
            script_content = browsergym_script_path.read_text(encoding='utf-8')
            # Inject into main page
            page.evaluate(script_content)
            # Inject into all iframes
            for iframe in page.frames:
                try:
                    iframe.evaluate(script_content)
                except Exception as e:
                    print(f"Error injecting into iframe: {e}")
        except Exception as e:
            print(f"Error injecting browsergym-inject.js: {e}")


def post_event(page: Page, action: str, **kwargs):
    """Re-inject monitoring script after an action"""
    inject_bgym_actions(page)


def custom_print(page: Page, locator: Locator, action: str, **kwargs):
    """
    Log action details before performing the action.
    Captures XPath, bid, and other metadata for replay/analysis.
    """
    inject_bgym_actions(page)
    time.sleep(2)
    
    def __get_xpath(locator):
        xpath_script = """
        node => {
            function getXPath(el) {
                if (el === null) return '';
                if (el.nodeType !== Node.ELEMENT_NODE) {
                    return getXPath(el.parentNode);
                }
                // If element has an ID, use the simple format: //*[@id='...']
                if (el.id) {
                    return "//*[@id='" + el.id + "']";
                }
                // Otherwise, build the path using tag names and indices
                const siblings = Array.from(el.parentNode ? el.parentNode.children : []);
                const sameTagSiblings = siblings.filter(n => n.tagName === el.tagName);
                const index = sameTagSiblings.indexOf(el) + 1;
                const tagName = el.tagName.toLowerCase();
                const parentPath = getXPath(el.parentNode);
                // If parent path starts with //, append to it; otherwise start new path
                if (parentPath.startsWith('//')) {
                    return parentPath + '/' + tagName + '[' + index + ']';
                } else {
                    return '//' + tagName + '[' + index + ']';
                }
            }
            return getXPath(node);
        }
        """
        try:
            return locator.evaluate(xpath_script)
        except Exception:
            return None
    
    def __get_bid(locator):
        try:
            bid = locator.get_attribute('bid')
            if bid:
                return bid
            else:
                return locator.evaluate("node => node.getAttribute('data-bid')")
        except Exception:
            return None
    
    bid = __get_bid(locator)
    xpath = __get_xpath(locator)
    print(f"action: {action}, bid: {bid}, xpath: {xpath} , value: {kwargs.get('value',None)}")
    
    # Write to JSON file
    with open('browsergym_actions.json', 'a') as f:
        f.write(json.dumps({
            'action': action,
            'xpath': xpath,
            'bid': bid,
            'value': kwargs.get('value'),
            **{k: v for k, v in kwargs.items() if k != 'value'}
        }) + '\n')

