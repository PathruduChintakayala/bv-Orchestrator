from __future__ import annotations

import subprocess
from typing import Dict


class RunnerInterface:
    """Simple interface to invoke bv-runner with an execution plan."""

    def __init__(self, runner_executable: str = "bv-runner"):
        self.runner_executable = runner_executable

    def execute(self, plan: Dict) -> bool:
        """Call bv-runner execute command."""
        entry = f"{plan['entrypoint_file'].replace('.py', '')}:{plan['entrypoint_method']}"
        try:
            result = subprocess.run(
                [
                    self.runner_executable,
                    "execute",
                    "--project",
                    plan["project_path"],
                    "--entrypoint",
                    entry,
                ],
                capture_output=True,
                text=True,
            )
            return result.returncode == 0
        except Exception:
            return False

