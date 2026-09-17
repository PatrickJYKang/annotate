"""Trusted host-only path registration. Never forwarded by the renderer proxy."""

import os
import tempfile
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..video_registry import register_video_path, resolve_video_ref
from ..services.normalization_jobs import start_normalization_job, get_normalization_result

router = APIRouter()


def require_managed():
    if not os.environ.get("ANNOTATE_AUTH_TOKEN"):
        raise HTTPException(status_code=404)


class RegisterRequest(BaseModel):
    path: str


@router.post("/register")
def register(request: RegisterRequest):
    require_managed()
    source = Path(request.path)
    if not source.is_absolute() or not source.is_file():
        raise HTTPException(status_code=400, detail="A host-authorized file is required.")
    return {"videoRef": register_video_path(source, owned=False), "filename": source.name, "sizeBytes": source.stat().st_size}


class ImportRequest(BaseModel):
    videoRef: str


@router.post("/import")
def start_import(request: ImportRequest):
    require_managed()
    source = resolve_video_ref(request.videoRef)
    if not source:
        raise HTTPException(status_code=404, detail="Unknown source.")
    # Only outputs belong to this temporary directory. Cleanup cannot delete the source.
    return start_normalization_job(tempfile.mkdtemp(prefix="annotate_native_import_"), source)


@router.get("/import/{job_id}/result")
def import_result(job_id: str):
    require_managed()
    result = get_normalization_result(job_id)
    if not result:
        raise HTTPException(status_code=409, detail="Import is not complete.")
    source, metadata = result
    return {"path": str(source), "metadata": metadata}
