"""
Environment Verifier - Tests BrowserGym environment setup

Checks:
- Required packages installed
- Environment variables set
- BrowserGym connection
- ServiceNow connectivity (optional)
- Browser launch capability
"""

import json
import os
import sys
from typing import Dict, List, Any
from dataclasses import dataclass, field
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@dataclass
class EnvVerificationResult:
    """Result of an environment verification check."""
    name: str
    passed: bool
    message: str
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class EnvVerificationReport:
    """Complete environment verification report."""
    timestamp: str
    total_checks: int
    passed_checks: int
    failed_checks: int
    results: List[EnvVerificationResult] = field(default_factory=list)
    summary: Dict[str, Any] = field(default_factory=dict)


class EnvVerifier:
    """Verifies BrowserGym environment setup."""
    
    REQUIRED_PACKAGES = [
        "gymnasium",
        "browsergym",
        "openai",
        "dotenv",
    ]
    
    OPTIONAL_PACKAGES = [
        "playwright",
        "numpy",
        "pandas",
    ]
    
    REQUIRED_ENV_VARS = [
        "OPENAI_API_KEY",
    ]
    
    OPTIONAL_ENV_VARS = [
        "SNOW_INSTANCE_URL",
        "SNOW_INSTANCE_UNAME", 
        "SNOW_INSTANCE_PWD",
    ]
    
    def __init__(self):
        self.results: List[EnvVerificationResult] = []
    
    def _add_result(self, name: str, passed: bool, message: str, details: Dict = None):
        """Add a verification result."""
        self.results.append(EnvVerificationResult(
            name=name,
            passed=passed,
            message=message,
            details=details or {}
        ))
    
    def verify_python_version(self) -> bool:
        """Check Python version is compatible."""
        version = sys.version_info
        version_str = f"{version.major}.{version.minor}.{version.micro}"
        
        passed = version.major == 3 and version.minor >= 9
        
        self._add_result(
            "Python Version",
            passed,
            f"Python {version_str}" if passed else f"Python {version_str} (requires 3.9+)",
            {"version": version_str, "major": version.major, "minor": version.minor}
        )
        return passed
    
    def verify_required_packages(self) -> bool:
        """Check required packages are installed."""
        installed = []
        missing = []
        versions = {}
        
        for package in self.REQUIRED_PACKAGES:
            try:
                pkg = __import__(package.replace("-", "_"))
                installed.append(package)
                versions[package] = getattr(pkg, "__version__", "unknown")
            except ImportError:
                missing.append(package)
        
        passed = len(missing) == 0
        
        self._add_result(
            "Required Packages",
            passed,
            f"All {len(self.REQUIRED_PACKAGES)} required packages installed" if passed else f"Missing: {missing}",
            {"installed": installed, "missing": missing, "versions": versions}
        )
        return passed
    
    def verify_optional_packages(self) -> bool:
        """Check optional packages."""
        installed = []
        missing = []
        
        for package in self.OPTIONAL_PACKAGES:
            try:
                __import__(package.replace("-", "_"))
                installed.append(package)
            except ImportError:
                missing.append(package)
        
        # Optional packages are not required
        passed = True
        
        self._add_result(
            "Optional Packages",
            passed,
            f"{len(installed)}/{len(self.OPTIONAL_PACKAGES)} optional packages installed",
            {"installed": installed, "missing": missing}
        )
        return passed
    
    def verify_env_vars(self) -> bool:
        """Check required environment variables."""
        # Load dotenv if available
        try:
            from dotenv import load_dotenv
            load_dotenv()
        except ImportError:
            pass
        
        found = []
        missing = []
        masked = {}
        
        for var in self.REQUIRED_ENV_VARS:
            value = os.environ.get(var)
            if value:
                found.append(var)
                # Mask sensitive values
                masked[var] = value[:4] + "..." + value[-4:] if len(value) > 10 else "***"
            else:
                missing.append(var)
        
        passed = len(missing) == 0
        
        self._add_result(
            "Environment Variables",
            passed,
            f"All {len(self.REQUIRED_ENV_VARS)} required env vars set" if passed else f"Missing: {missing}",
            {"found": found, "missing": missing, "masked_values": masked}
        )
        return passed
    
    def verify_optional_env_vars(self) -> bool:
        """Check optional environment variables (ServiceNow)."""
        found = []
        missing = []
        
        for var in self.OPTIONAL_ENV_VARS:
            if os.environ.get(var):
                found.append(var)
            else:
                missing.append(var)
        
        # Optional - just report status
        passed = True
        message = f"{len(found)}/{len(self.OPTIONAL_ENV_VARS)} ServiceNow env vars set"
        if len(found) == 0:
            message += " (ServiceNow tests will be skipped)"
        
        self._add_result(
            "ServiceNow Config",
            passed,
            message,
            {"found": found, "missing": missing}
        )
        return passed
    
    def verify_browsergym_import(self) -> bool:
        """Check BrowserGym can be imported."""
        try:
            import browsergym.workarena
            self._add_result(
                "BrowserGym Import",
                True,
                "BrowserGym WorkArena imported successfully",
                {}
            )
            return True
        except ImportError as e:
            self._add_result(
                "BrowserGym Import",
                False,
                f"Failed to import BrowserGym: {str(e)[:50]}",
                {"error": str(e)}
            )
            return False
        except Exception as e:
            self._add_result(
                "BrowserGym Import",
                False,
                f"Error importing BrowserGym: {str(e)[:50]}",
                {"error": str(e)}
            )
            return False
    
    def verify_openai_connection(self) -> bool:
        """Check OpenAI API connection."""
        try:
            from openai import OpenAI
            from dotenv import load_dotenv
            load_dotenv()
            
            api_key = os.environ.get("OPENAI_API_KEY")
            if not api_key:
                self._add_result(
                    "OpenAI Connection",
                    False,
                    "OPENAI_API_KEY not set",
                    {}
                )
                return False
            
            client = OpenAI(api_key=api_key)
            # Quick test - list models
            models = client.models.list()
            model_count = len(list(models)[:5])
            
            self._add_result(
                "OpenAI Connection",
                True,
                f"Connected to OpenAI API ({model_count}+ models available)",
                {"model_count": model_count}
            )
            return True
        except Exception as e:
            self._add_result(
                "OpenAI Connection",
                False,
                f"OpenAI connection failed: {str(e)[:50]}",
                {"error": str(e)}
            )
            return False
    
    def verify_playwright(self) -> bool:
        """Check Playwright is installed and has browsers."""
        try:
            import subprocess
            result = subprocess.run(
                ["playwright", "--version"],
                capture_output=True,
                text=True,
                timeout=10
            )
            if result.returncode == 0:
                version = result.stdout.strip()
                self._add_result(
                    "Playwright",
                    True,
                    f"Playwright installed: {version}",
                    {"version": version}
                )
                return True
            else:
                self._add_result(
                    "Playwright",
                    False,
                    "Playwright not found",
                    {}
                )
                return False
        except FileNotFoundError:
            self._add_result(
                "Playwright",
                False,
                "Playwright CLI not found (run: pip install playwright && playwright install)",
                {}
            )
            return False
        except Exception as e:
            self._add_result(
                "Playwright",
                False,
                f"Playwright check failed: {str(e)[:50]}",
                {"error": str(e)}
            )
            return False
    
    def verify_disk_space(self) -> bool:
        """Check available disk space."""
        try:
            import shutil
            total, used, free = shutil.disk_usage("/")
            free_gb = free // (1024**3)
            
            passed = free_gb >= 1  # At least 1GB free
            
            self._add_result(
                "Disk Space",
                passed,
                f"{free_gb}GB free disk space" if passed else f"Low disk space: {free_gb}GB",
                {"free_gb": free_gb, "total_gb": total // (1024**3)}
            )
            return passed
        except Exception as e:
            self._add_result(
                "Disk Space",
                True,  # Non-critical
                f"Could not check disk space: {str(e)[:30]}",
                {}
            )
            return True
    
    def run_verification(self, quick: bool = False) -> EnvVerificationReport:
        """Run all verification checks."""
        print(f"\n{'='*60}")
        print("🔧 ENVIRONMENT VERIFICATION")
        print(f"{'='*60}")
        
        self.verify_python_version()
        self.verify_required_packages()
        self.verify_optional_packages()
        self.verify_env_vars()
        self.verify_optional_env_vars()
        self.verify_browsergym_import()
        
        if not quick:
            self.verify_openai_connection()
            self.verify_playwright()
            self.verify_disk_space()
        
        passed = sum(1 for r in self.results if r.passed)
        failed = sum(1 for r in self.results if not r.passed)
        
        return EnvVerificationReport(
            timestamp=datetime.now().isoformat(),
            total_checks=len(self.results),
            passed_checks=passed,
            failed_checks=failed,
            results=self.results,
            summary={
                "env_ready": failed == 0,
                "success_rate": round(passed / len(self.results) * 100, 1) if self.results else 0
            }
        )


def print_report(report: EnvVerificationReport):
    """Print verification report."""
    print(f"\n{'─'*60}")
    print("📋 ENVIRONMENT VERIFICATION RESULTS")
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
    print(f"  Environment Ready: {'✅ YES' if report.summary['env_ready'] else '❌ NO'}")
    print(f"{'='*60}\n")


def verify_environment(quick: bool = False, save_report: bool = True) -> EnvVerificationReport:
    """Main function to verify environment."""
    verifier = EnvVerifier()
    report = verifier.run_verification(quick=quick)
    
    print_report(report)
    
    if save_report:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        report_path = os.path.join(script_dir, "env_verification_report.json")
        report_dict = {
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
    
    parser = argparse.ArgumentParser(description="Verify BrowserGym environment setup")
    parser.add_argument("--quick", action="store_true", help="Skip slow checks (API, Playwright)")
    parser.add_argument("--no-save", action="store_true", help="Don't save verification report")
    
    args = parser.parse_args()
    
    verify_environment(quick=args.quick, save_report=not args.no_save)

