from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _sidecar_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _default_upstream_root() -> Path:
    explicit = os.getenv("ANNOTATE_PNLCALIB_ROOT")
    if explicit:
        return Path(explicit).expanduser()

    candidates = [
        _sidecar_root() / "third_party" / "pnlcalib",
        _repo_root().parent / "trackers" / "third_party" / "pnlcalib",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def _default_config_path() -> Path:
    explicit = os.getenv("ANNOTATE_PNLCALIB_CONFIG")
    if explicit:
        return Path(explicit).expanduser()
    return _sidecar_root() / "annotate_sidecar" / "config" / "pnlcalib.default.toml"


@dataclass(frozen=True)
class CalibrationDefaults:
    provider_name: str
    upstream_root: Path
    config_path: Path

    def to_public_dict(self) -> dict:
        return {
            "providerName": self.provider_name,
            "upstreamRoot": str(self.upstream_root),
            "configPath": str(self.config_path),
        }


@lru_cache(maxsize=1)
def get_calibration_defaults() -> CalibrationDefaults:
    return CalibrationDefaults(
        provider_name="pnlcalib",
        upstream_root=_default_upstream_root(),
        config_path=_default_config_path(),
    )
