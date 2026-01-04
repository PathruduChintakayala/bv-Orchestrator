from __future__ import annotations

from pathlib import Path
from typing import List, Dict, Any, Tuple

from backend.project_config import ProjectConfig


class OrchestratorService:
    """Validate BV projects and produce execution plans."""

    def __init__(self, project_path: str):
        self.project_path = Path(project_path)
        self.config: ProjectConfig | None = None

    def load(self) -> Tuple[bool, List[str]]:
        errors: List[str] = []
        try:
            self.config = ProjectConfig.from_yaml(str(self.project_path))
        except Exception as exc:
            errors.append(str(exc))
            return False, errors
        # basic validation
        if ":" not in self.config.entrypoint:
            errors.append("Entrypoint must be in module:function format")
        entry_file, _ = self.config.entrypoint_parts()
        if not (self.project_path / entry_file).exists():
            errors.append(f"Entrypoint file not found: {entry_file}")
        if not (self.project_path / "requirements.lock").exists():
            errors.append("requirements.lock is required; run 'bv publish' to generate it")
        return len(errors) == 0, errors

    def execution_plan(self) -> Dict[str, Any]:
        if not self.config:
            raise RuntimeError("config not loaded")
        entry_file, method = self.config.entrypoint_parts()
        return {
            "project_path": str(self.project_path),
            "project_name": self.config.name,
            "project_version": self.config.version,
            "entrypoint_file": entry_file,
            "entrypoint_method": method,
            "python_version": self.config.python_version,
            "dependencies": self.config.dependencies,
            "requires_lock_file": True,
        }

