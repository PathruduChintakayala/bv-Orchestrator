import json
import re
import zipfile
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import yaml


SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")
COMMAND_RE = re.compile(r"^(?:[A-Za-z_][A-Za-z0-9_.]*:[A-Za-z_][A-Za-z0-9_]*|.*\.py)$")
NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")

# Minimal package requirements (aligned with new SDK): bvproject.yaml + main.py + requirements.lock + manifest.json
REQUIRED_FILES = {"bvproject.yaml", "main.py", "requirements.lock", "manifest.json"}
FORBIDDEN_PREFIXES = (".venv/", "__pycache__/", "dist/", ".git/")


class BvPackageValidationError(ValueError):
    pass


@dataclass(frozen=True)
class BvEntrypoint:
    name: str
    command: str
    default: bool


@dataclass(frozen=True)
class BvPackageInfo:
    package_name: str
    version: str
    entrypoints: List[Dict[str, Any]]
    default_entrypoint_name: str
    process_type: str


def _normalize_zip_path(path: str) -> str:
    # ZIP paths are always forward-slash; guard against weird leading slashes.
    return (path or "").lstrip("/")


ALLOWED_PROCESS_TYPES = {"rpa", "agent"}


def _load_bvproject_yaml(text: str) -> Tuple[str, str, List[BvEntrypoint], str, str]:
    try:
        data = yaml.safe_load(text) or {}
    except Exception as e:
        raise BvPackageValidationError(f"bvproject.yaml is not valid YAML: {e}")

    # New minimal format: bvproject.yaml with top-level "project" mapping
    project = data.get("project") if isinstance(data, dict) else None
    if project is None or not isinstance(project, dict):
        raise BvPackageValidationError("bvproject.yaml must contain 'project' mapping")

    name = project.get("name")
    version = project.get("version")
    entrypoints = project.get("entrypoints")
    entrypoint = project.get("entrypoint")
    ptype = str(project.get("type") or "rpa").strip().lower()
    if ptype not in ALLOWED_PROCESS_TYPES:
        raise BvPackageValidationError("bvproject.yaml: project.type must be one of: rpa, agent")

    if not isinstance(name, str) or not name.strip():
        raise BvPackageValidationError("bvproject.yaml: 'name' is required and must be a non-empty string")
    name = name.strip()
    if not NAME_RE.match(name):
        raise BvPackageValidationError("bvproject.yaml: 'name' must match [A-Za-z0-9_-]")
    if not isinstance(version, str) or not version.strip():
        raise BvPackageValidationError("bvproject.yaml: 'version' is required and must be a non-empty string")
    version = version.strip()
    if not SEMVER_RE.match(version):
        raise BvPackageValidationError("bvproject.yaml: 'version' must be SemVer 'X.Y.Z'")

    # Support both new format (entrypoints) and legacy format (entrypoint)
    if entrypoints:
        # New format: entrypoints is a list
        if not isinstance(entrypoints, list) or len(entrypoints) == 0:
            raise BvPackageValidationError("bvproject.yaml: 'entrypoints' must be a non-empty list")
        
        defaults = [e for e in entrypoints if isinstance(e, dict) and e.get("default")]
        if len(defaults) != 1:
            raise BvPackageValidationError("bvproject.yaml: 'entrypoints' must have exactly one entrypoint marked as default")
        
        parsed = []
        default_name = None
        for ep in entrypoints:
            if not isinstance(ep, dict):
                raise BvPackageValidationError("bvproject.yaml: each entrypoint in 'entrypoints' must be a mapping")
            ep_name = str(ep.get("name", "")).strip()
            ep_command = str(ep.get("command", "")).strip()
            ep_default = bool(ep.get("default", False))
            
            if not ep_name:
                raise BvPackageValidationError("bvproject.yaml: each entrypoint must have a 'name'")
            if not ep_command:
                raise BvPackageValidationError(f"bvproject.yaml: entrypoint '{ep_name}' must have a 'command'")
            if not COMMAND_RE.match(ep_command):
                raise BvPackageValidationError(f"bvproject.yaml: entrypoint '{ep_name}' command must be 'module:function' or end with .py")
            
            parsed.append(BvEntrypoint(name=ep_name, command=ep_command, default=ep_default))
            if ep_default:
                default_name = ep_name
        
        if not default_name:
            raise BvPackageValidationError("bvproject.yaml: no default entrypoint found in 'entrypoints'")
        
        return name, version, parsed, default_name, ptype
    elif entrypoint:
        # Legacy format: entrypoint is a string
        if not isinstance(entrypoint, str) or not entrypoint.strip():
            raise BvPackageValidationError("bvproject.yaml: 'entrypoint' is required and must be a non-empty string")
        entrypoint = entrypoint.strip()
        if not COMMAND_RE.match(entrypoint):
            raise BvPackageValidationError("bvproject.yaml: 'entrypoint' must be 'module:function' or end with .py")

        # Minimal model: single default entrypoint derived from entrypoint string
        parsed = [BvEntrypoint(name="main", command=entrypoint, default=True)]
        return name, version, parsed, "main", ptype
    else:
        raise BvPackageValidationError("bvproject.yaml: either 'entrypoint' or 'entrypoints' is required")


def _validate_entry_points_json(text: str) -> None:
    try:
        json.loads(text)
    except Exception as e:
        raise BvPackageValidationError(f"entry-points.json must be valid JSON: {e}")


def validate_and_extract_bvpackage(zip_path: str) -> BvPackageInfo:
    """Validate a .bvpackage file stored on disk and return extracted metadata.

    Raises BvPackageValidationError with a human-readable message when invalid.
    """
    try:
        zf = zipfile.ZipFile(zip_path, "r")
    except Exception as e:
        raise BvPackageValidationError(f"File is not a valid ZIP archive: {e}")

    with zf:
        names = [_normalize_zip_path(n) for n in zf.namelist()]
        name_set = set(names)

        # Required files
        missing = [f for f in REQUIRED_FILES if f not in name_set]
        if missing:
            raise BvPackageValidationError(
                "Missing required file(s): " + ", ".join(missing)
            )

        # Forbidden content
        forbidden_hits: List[str] = []
        for n in names:
            for prefix in FORBIDDEN_PREFIXES:
                if n.startswith(prefix):
                    forbidden_hits.append(n)
                    break
        if forbidden_hits:
            sample = ", ".join(forbidden_hits[:5])
            more = "" if len(forbidden_hits) <= 5 else f" (+{len(forbidden_hits) - 5} more)"
            raise BvPackageValidationError(
                "Forbidden content present in archive (remove these paths): " + sample + more
            )

        try:
            bvproject_raw = zf.read("bvproject.yaml").decode("utf-8")
        except Exception as e:
            raise BvPackageValidationError(f"Failed to read bvproject.yaml as UTF-8 text: {e}")
        pkg_name, version, eps, default_name, process_type = _load_bvproject_yaml(bvproject_raw)

        return BvPackageInfo(
            package_name=pkg_name,
            version=version,
            entrypoints=[{"name": e.name, "command": e.command, "default": bool(e.default)} for e in eps],
            default_entrypoint_name=default_name,
            process_type=process_type,
        )


def entrypoint_exists(entrypoints_json: Optional[str], entrypoint_name: str) -> bool:
    if not entrypoints_json:
        return False
    try:
        eps = json.loads(entrypoints_json)
    except Exception:
        return False
    if not isinstance(eps, list):
        return False
    for ep in eps:
        if isinstance(ep, dict) and ep.get("name") == entrypoint_name:
            return True
    return False
