from __future__ import annotations

from typing import Any


def main(input: dict[str, Any] | None = None) -> dict[str, Any]:
    # Emit one message per level so runner log collection can be verified.
    print("TRACE: entering main")
    print("INFO: processing request")
    print("WARN: this is a sample warning")
    print("ERROR: sample error log (non-fatal)")

    data = input or {}
    name = str(data.get("name", "World"))
    return {"result": f"Hello {name}"}
