from __future__ import annotations

import yaml
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional


@dataclass
class ProjectConfig:
    name: str
    version: str
    description: Optional[str]
    entrypoint: str
    python_version: str
    dependencies: List[str]

    @classmethod
    def from_yaml(cls, project_path: str) -> "ProjectConfig":
        config_path = Path(project_path) / "bvproject.yaml"
        if not config_path.exists():
            raise FileNotFoundError(f"bvproject.yaml not found at {project_path}")
        with config_path.open("r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
        project = data.get("project") or {}
        return cls(
            name=str(project.get("name") or ""),
            version=str(project.get("version") or ""),
            description=project.get("description") or "",
            entrypoint=str(project.get("entrypoint") or ""),
            python_version=str(project.get("python_version") or "3.8"),
            dependencies=list(project.get("dependencies") or []),
        )

    def entrypoint_parts(self) -> tuple[str, str]:
        file_part, method = self.entrypoint.split(":")
        if not file_part.endswith(".py"):
            file_part = f"{file_part}.py"
        return file_part, method

