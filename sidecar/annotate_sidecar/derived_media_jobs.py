from __future__ import annotations

import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock, Thread
from typing import Callable, Literal, Optional

logger = logging.getLogger("annotate_sidecar.derived_media_jobs")

DerivedMediaJobKind = Literal["preview_proxy"]
DerivedMediaJobStatus = Literal["queued", "running", "finalizing", "ready", "failed", "cancelled"]


@dataclass
class DerivedMediaJob:
    job_id: str
    kind: DerivedMediaJobKind
    status: DerivedMediaJobStatus
    created_at: str
    updated_at: str
    label: Optional[str] = None
    output_path: Optional[str] = None
    size_bytes: Optional[int] = None
    error: Optional[str] = None


_jobs: dict[str, DerivedMediaJob] = {}
_jobs_lock = Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cleanup_file(path: Optional[str]) -> None:
    if not path:
        return
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except Exception as exc:  # pragma: no cover - non-critical cleanup warning
        logger.warning("Failed deleting derived-media temp file %s: %s", path, exc)


def _update_job(job_id: str, **changes) -> Optional[DerivedMediaJob]:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        for key, value in changes.items():
            setattr(job, key, value)
        job.updated_at = _now_iso()
        return job


def serialize_derived_media_job(job: DerivedMediaJob) -> dict:
    output_available = bool(job.output_path and Path(job.output_path).is_file())
    return {
        "jobId": job.job_id,
        "kind": job.kind,
        "status": job.status,
        "createdAt": job.created_at,
        "updatedAt": job.updated_at,
        "label": job.label,
        "sizeBytes": job.size_bytes,
        "error": job.error,
        "outputAvailable": output_available,
    }


def get_derived_media_job(job_id: str) -> Optional[DerivedMediaJob]:
    with _jobs_lock:
        return _jobs.get(job_id)


def create_derived_media_job(
    *,
    kind: DerivedMediaJobKind,
    runner: Callable[[], str],
    running_label: str,
    finalizing_label: str = "Finalizing output",
) -> DerivedMediaJob:
    job = DerivedMediaJob(
        job_id=uuid.uuid4().hex[:16],
        kind=kind,
        status="queued",
        created_at=_now_iso(),
        updated_at=_now_iso(),
        label="Queued",
    )
    with _jobs_lock:
        _jobs[job.job_id] = job

    def run_job() -> None:
        _update_job(job.job_id, status="running", label=running_label, error=None)
        try:
            output_path = runner()
            size_bytes = Path(output_path).stat().st_size if Path(output_path).is_file() else None
            _update_job(
                job.job_id,
                status="finalizing",
                label=finalizing_label,
                output_path=output_path,
                size_bytes=size_bytes,
                error=None,
            )
            _update_job(
                job.job_id,
                status="ready",
                label="Ready",
                output_path=output_path,
                size_bytes=size_bytes,
                error=None,
            )
            logger.info(
                "Derived-media job %s finished kind=%s output=%s size=%s",
                job.job_id,
                kind,
                output_path,
                size_bytes if size_bytes is not None else "missing",
            )
        except Exception as exc:
            _update_job(job.job_id, status="failed", label="Failed", error=str(exc))
            logger.exception("Derived-media job %s failed kind=%s", job.job_id, kind)

    Thread(target=run_job, name=f"derived-media-{kind}-{job.job_id}", daemon=True).start()
    return job


def delete_derived_media_job(job_id: str) -> tuple[bool, Optional[str]]:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return False, "missing"
        if job.status in {"queued", "running", "finalizing"}:
            return False, "active"
        output_path = job.output_path
        _jobs.pop(job_id, None)

    _cleanup_file(output_path)
    return True, None


def cleanup_derived_media_jobs() -> None:
    with _jobs_lock:
        jobs = list(_jobs.values())
        _jobs.clear()
    for job in jobs:
        _cleanup_file(job.output_path)
