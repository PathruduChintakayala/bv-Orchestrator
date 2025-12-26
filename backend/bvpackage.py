import json
import re
import zipfile
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import yaml


SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")
COMMAND_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*:[A-Za-z_][A-Za-z0-9_]*$")
NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")

REQUIRED_FILES = {"bvproject.yaml", "entry-points.json", "pyproject.toml"}
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


def _normalize_zip_path(path: str) -> str:
    # ZIP paths are always forward-slash; guard against weird leading slashes.
    return (path or "").lstrip("/")


def _load_bvproject_yaml(text: str) -> Tuple[str, str, List[BvEntrypoint], str]:
    try:
        data = yaml.safe_load(text) or {}
    except Exception as e:
        raise BvPackageValidationError(f"bvproject.yaml is not valid YAML: {e}")

    name = data.get("name")
    version = data.get("version")
    entrypoints = data.get("entrypoints")

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

    if not isinstance(entrypoints, list) or len(entrypoints) == 0:
        raise BvPackageValidationError("bvproject.yaml: 'entrypoints' must be a non-empty list")

    parsed: List[BvEntrypoint] = []
    seen_names = set()
    default_names: List[str] = []
    for i, ep in enumerate(entrypoints):
        if not isinstance(ep, dict):
            raise BvPackageValidationError(f"bvproject.yaml: entrypoints[{i}] must be an object")
        ep_name = ep.get("name")
        command = ep.get("command")
        default = bool(ep.get("default", False))

        if not isinstance(ep_name, str) or not ep_name.strip():
            raise BvPackageValidationError(f"bvproject.yaml: entrypoints[{i}].name must be a non-empty string")
        ep_name = ep_name.strip()
        if ep_name in seen_names:
            raise BvPackageValidationError(f"bvproject.yaml: duplicate entrypoint name '{ep_name}'")
        seen_names.add(ep_name)

        if not isinstance(command, str) or not command.strip():
            raise BvPackageValidationError(f"bvproject.yaml: entrypoints[{i}].command must be a non-empty string")
        command = command.strip()
        if not COMMAND_RE.match(command):
            raise BvPackageValidationError(
                f"bvproject.yaml: entrypoints[{i}].command must be 'module:function' (got '{command}')"
            )

        if default:
            default_names.append(ep_name)

        parsed.append(BvEntrypoint(name=ep_name, command=command, default=default))

    if len(default_names) != 1:
        raise BvPackageValidationError(
            f"bvproject.yaml: exactly one entrypoint must have default=true (found {len(default_names)})"
        )

    return name, version, parsed, default_names[0]


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
        pkg_name, version, eps, default_name = _load_bvproject_yaml(bvproject_raw)

        try:
            ep_json_raw = zf.read("entry-points.json").decode("utf-8")
        except Exception as e:
            raise BvPackageValidationError(f"Failed to read entry-points.json as UTF-8 text: {e}")
        _validate_entry_points_json(ep_json_raw)

        return BvPackageInfo(
            package_name=pkg_name,
            version=version,
            entrypoints=[{"name": e.name, "command": e.command, "default": bool(e.default)} for e in eps],
            default_entrypoint_name=default_name,
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
