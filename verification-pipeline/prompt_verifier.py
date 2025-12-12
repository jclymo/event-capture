"""
Prompt Verifier - Validates ICL prompt generation

Checks:
- Prompt structure and sections
- Step-by-step demonstration format
- Action code syntax in prompts
- Key patterns and tips presence
- Prompt length and completeness
"""

import json
import os
import re
from typing import Dict, List, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@dataclass
class PromptVerificationResult:
    """Result of a prompt verification check."""
    name: str
    passed: bool
    message: str
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PromptVerificationReport:
    """Complete prompt verification report."""
    prompt_path: str
    timestamp: str
    total_checks: int
    passed_checks: int
    failed_checks: int
    results: List[PromptVerificationResult] = field(default_factory=list)
    summary: Dict[str, Any] = field(default_factory=dict)


class PromptVerifier:
    """Verifies ICL prompt structure and content."""
    
    REQUIRED_SECTIONS = [
        "DEMONSTRATION",
        "TASK",
        "STEP",
        "PATTERN",
    ]
    
    ACTION_PATTERNS = [
        r'click\(["\'][^"\']+["\']\)',
        r'fill\(["\'][^"\']+["\'],\s*["\'][^"\']*["\']\)',
        r'select_option\(["\'][^"\']+["\'],\s*["\'][^"\']*["\']\)',
    ]
    
    def __init__(self, prompt_content: str):
        self.prompt = prompt_content
        self.results: List[PromptVerificationResult] = []
    
    def _add_result(self, name: str, passed: bool, message: str, details: Dict = None):
        """Add a verification result."""
        self.results.append(PromptVerificationResult(
            name=name,
            passed=passed,
            message=message,
            details=details or {}
        ))
    
    def verify_prompt_length(self) -> bool:
        """Verify prompt has reasonable length."""
        length = len(self.prompt)
        word_count = len(self.prompt.split())
        line_count = len(self.prompt.split('\n'))
        
        # ICL prompt should be substantial but not too long
        min_length = 500
        max_length = 50000
        
        passed = min_length <= length <= max_length
        
        self._add_result(
            "Prompt Length",
            passed,
            f"Prompt length: {length} chars, {word_count} words, {line_count} lines" if passed else f"Prompt length out of range: {length} (expected {min_length}-{max_length})",
            {
                "char_count": length,
                "word_count": word_count,
                "line_count": line_count
            }
        )
        return passed
    
    def verify_required_sections(self) -> bool:
        """Verify required sections are present."""
        prompt_upper = self.prompt.upper()
        found_sections = []
        missing_sections = []
        
        for section in self.REQUIRED_SECTIONS:
            if section in prompt_upper:
                found_sections.append(section)
            else:
                missing_sections.append(section)
        
        passed = len(missing_sections) == 0
        
        self._add_result(
            "Required Sections",
            passed,
            f"All {len(self.REQUIRED_SECTIONS)} required sections found" if passed else f"Missing sections: {missing_sections}",
            {
                "found_sections": found_sections,
                "missing_sections": missing_sections
            }
        )
        return passed
    
    def verify_step_format(self) -> bool:
        """Verify step-by-step demonstration format."""
        # Look for step patterns like "Step 1", "### Step 1", etc.
        step_patterns = [
            r'step\s+\d+',
            r'##+\s*step\s+\d+',
            r'\*\*step\s+\d+\*\*',
        ]
        
        steps_found = []
        for pattern in step_patterns:
            matches = re.findall(pattern, self.prompt, re.IGNORECASE)
            steps_found.extend(matches)
        
        # Extract step numbers
        step_numbers = []
        for step in steps_found:
            num_match = re.search(r'\d+', step)
            if num_match:
                step_numbers.append(int(num_match.group()))
        
        unique_steps = sorted(set(step_numbers))
        
        passed = len(unique_steps) >= 1
        
        self._add_result(
            "Step Format",
            passed,
            f"Found {len(unique_steps)} steps: {unique_steps[:10]}..." if len(unique_steps) > 10 else f"Found {len(unique_steps)} steps: {unique_steps}" if passed else "No step-by-step format found",
            {
                "steps_found": len(steps_found),
                "unique_step_numbers": unique_steps,
                "step_count": len(unique_steps)
            }
        )
        return passed
    
    def verify_action_codes(self) -> bool:
        """Verify action code examples are present."""
        actions_found = {
            "click": [],
            "fill": [],
            "select_option": []
        }
        
        for action_type, pattern in [
            ("click", r'click\(["\'][^"\']+["\']\)'),
            ("fill", r'fill\(["\'][^"\']+["\'],\s*["\'][^"\']*["\']\)'),
            ("select_option", r'select_option\(["\'][^"\']+["\'],\s*["\'][^"\']*["\']\)')
        ]:
            matches = re.findall(pattern, self.prompt)
            actions_found[action_type] = matches[:5]  # Keep first 5 examples
        
        total_actions = sum(len(v) for v in actions_found.values())
        
        passed = total_actions >= 1
        
        self._add_result(
            "Action Code Examples",
            passed,
            f"Found {total_actions} action code examples" if passed else "No action code examples found",
            {
                "click_examples": actions_found["click"][:3],
                "fill_examples": actions_found["fill"][:3],
                "select_examples": actions_found["select_option"][:3],
                "total_action_examples": total_actions
            }
        )
        return passed
    
    def verify_element_references(self) -> bool:
        """Verify element references (role, name, bid) are present."""
        references = {
            "role": len(re.findall(r'role[=:]["\']\w+', self.prompt, re.IGNORECASE)),
            "name": len(re.findall(r'name[=:]["\'][^"\']+["\']', self.prompt, re.IGNORECASE)),
            "bid": len(re.findall(r'bid[=:]?["\']?\w+', self.prompt, re.IGNORECASE)),
            "element": len(re.findall(r'\belement\b', self.prompt, re.IGNORECASE))
        }
        
        total_refs = sum(references.values())
        
        passed = total_refs >= 3
        
        self._add_result(
            "Element References",
            passed,
            f"Found {total_refs} element references" if passed else "Insufficient element references",
            references
        )
        return passed
    
    def verify_goal_references(self) -> bool:
        """Verify goal/task references are present."""
        goal_keywords = ["goal", "task", "objective", "create", "fill", "submit"]
        found_keywords = {}
        
        for keyword in goal_keywords:
            count = len(re.findall(rf'\b{keyword}\b', self.prompt, re.IGNORECASE))
            if count > 0:
                found_keywords[keyword] = count
        
        total = sum(found_keywords.values())
        
        passed = total >= 5
        
        self._add_result(
            "Goal References",
            passed,
            f"Found {total} goal-related keywords" if passed else "Insufficient goal references",
            {
                "keyword_counts": found_keywords,
                "total": total
            }
        )
        return passed
    
    def verify_patterns_section(self) -> bool:
        """Verify key patterns section exists."""
        pattern_keywords = [
            "pattern",
            "workflow",
            "how to",
            "tip",
            "important",
            "critical"
        ]
        
        found = {}
        for keyword in pattern_keywords:
            count = len(re.findall(rf'\b{keyword}s?\b', self.prompt, re.IGNORECASE))
            if count > 0:
                found[keyword] = count
        
        total = sum(found.values())
        
        passed = total >= 2
        
        self._add_result(
            "Patterns/Tips Section",
            passed,
            f"Found {len(found)} pattern/tip keywords" if passed else "Missing patterns/tips section",
            {
                "keyword_counts": found,
                "total": total
            }
        )
        return passed
    
    def verify_servicenow_context(self) -> bool:
        """Verify ServiceNow-specific context (if applicable)."""
        sn_keywords = [
            "servicenow",
            "hardware asset",
            "form",
            "lookup",
            "textbox",
            "dropdown"
        ]
        
        found = {}
        for keyword in sn_keywords:
            count = len(re.findall(rf'\b{keyword}\b', self.prompt, re.IGNORECASE))
            if count > 0:
                found[keyword] = count
        
        total = sum(found.values())
        
        # This is optional - not all prompts need ServiceNow context
        passed = True  # Always pass but report findings
        
        self._add_result(
            "Domain Context",
            passed,
            f"Found {len(found)} domain-specific keywords" if found else "No domain-specific keywords (may be generic prompt)",
            {
                "keyword_counts": found,
                "total": total
            }
        )
        return passed
    
    def verify_markdown_formatting(self) -> bool:
        """Verify markdown formatting is consistent."""
        formatting_elements = {
            "headers": len(re.findall(r'^#+\s+', self.prompt, re.MULTILINE)),
            "bold": len(re.findall(r'\*\*[^*]+\*\*', self.prompt)),
            "code_inline": len(re.findall(r'`[^`]+`', self.prompt)),
            "code_blocks": len(re.findall(r'```[\s\S]*?```', self.prompt)),
            "lists": len(re.findall(r'^[-*]\s+', self.prompt, re.MULTILINE)),
            "numbered_lists": len(re.findall(r'^\d+\.\s+', self.prompt, re.MULTILINE))
        }
        
        total_formatting = sum(formatting_elements.values())
        
        # Good prompts have some formatting
        passed = total_formatting >= 5
        
        self._add_result(
            "Markdown Formatting",
            passed,
            f"Found {total_formatting} formatting elements" if passed else "Minimal formatting",
            formatting_elements
        )
        return passed
    
    def verify_no_placeholders(self) -> bool:
        """Verify no incomplete placeholders remain."""
        placeholder_patterns = [
            r'\[TODO\]',
            r'\[PLACEHOLDER\]',
            r'<INSERT.*>',
            r'\{.*\}',  # Curly brace placeholders
            r'XXX',
            r'FIXME'
        ]
        
        found_placeholders = []
        for pattern in placeholder_patterns:
            matches = re.findall(pattern, self.prompt, re.IGNORECASE)
            if matches:
                found_placeholders.extend(matches[:3])
        
        passed = len(found_placeholders) == 0
        
        self._add_result(
            "No Placeholders",
            passed,
            "No incomplete placeholders found" if passed else f"Found {len(found_placeholders)} placeholders",
            {
                "placeholders_found": found_placeholders[:5]
            }
        )
        return passed
    
    def run_verification(self) -> PromptVerificationReport:
        """Run all verification checks."""
        print(f"\n{'='*60}")
        print("📝 PROMPT VERIFICATION")
        print(f"{'='*60}")
        
        self.verify_prompt_length()
        self.verify_required_sections()
        self.verify_step_format()
        self.verify_action_codes()
        self.verify_element_references()
        self.verify_goal_references()
        self.verify_patterns_section()
        self.verify_servicenow_context()
        self.verify_markdown_formatting()
        self.verify_no_placeholders()
        
        passed = sum(1 for r in self.results if r.passed)
        failed = sum(1 for r in self.results if not r.passed)
        
        return PromptVerificationReport(
            prompt_path="",
            timestamp=datetime.now().isoformat(),
            total_checks=len(self.results),
            passed_checks=passed,
            failed_checks=failed,
            results=self.results,
            summary={
                "prompt_valid": failed == 0,
                "success_rate": round(passed / len(self.results) * 100, 1) if self.results else 0,
                "prompt_length": len(self.prompt)
            }
        )


def print_report(report: PromptVerificationReport):
    """Print verification report."""
    print(f"\n{'─'*60}")
    print("📋 PROMPT VERIFICATION RESULTS")
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
    print(f"  Prompt Valid: {'✅ YES' if report.summary['prompt_valid'] else '❌ NO'}")
    print(f"{'='*60}\n")


def verify_prompt(prompt_path: str = None, prompt_content: str = None, save_report: bool = True) -> PromptVerificationReport:
    """Main function to verify ICL prompt."""
    if prompt_content is None:
        if prompt_path is None:
            raise ValueError("Must provide either prompt_path or prompt_content")
        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompt_content = f.read()
    
    verifier = PromptVerifier(prompt_content)
    report = verifier.run_verification()
    report.prompt_path = prompt_path or "in-memory"
    
    print_report(report)
    
    if save_report and prompt_path:
        report_path = prompt_path.replace(".txt", "_prompt_verification.json")
        report_dict = {
            "prompt_path": report.prompt_path,
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
    
    parser = argparse.ArgumentParser(description="Verify ICL prompt generation")
    parser.add_argument("prompt", nargs="?", help="Path to ICL prompt file")
    parser.add_argument("--no-save", action="store_true", help="Don't save verification report")
    
    args = parser.parse_args()
    
    # Default paths to check
    if args.prompt:
        prompt_paths = [args.prompt]
    else:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(script_dir)
        prompt_paths = [
            os.path.join(parent_dir, "post_processing", "create_hardware_asset_icl_prompt.txt"),
            os.path.join(parent_dir, "icl", "create_hardware_asset_icl_prompt.txt"),
            os.path.join(parent_dir, "icl", "context_prompt.txt"),
        ]
    
    for path in prompt_paths:
        if os.path.exists(path):
            print(f"📂 Loading prompt from: {path}")
            verify_prompt(path, save_report=not args.no_save)
            break
    else:
        print(f"❌ No prompt file found. Please specify path.")
        print(f"   Searched: {prompt_paths}")

