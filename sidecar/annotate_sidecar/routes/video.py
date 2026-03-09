"""Video registration routes for sidecar clip operations.

These routes let the browser upload a source clip video once and receive a
`videoRef` token that can be used by /track, /segment, and /homography.
"""

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..video_registry import register_video_file, unregister_video_ref

router = APIRouter()


@router.post("/register")
async def register_video(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded video file is empty")

    video_ref = register_video_file(file.filename, data)
    return {
        "videoRef": video_ref,
        "filename": file.filename,
        "sizeBytes": len(data),
    }


@router.delete("/{video_ref}")
async def delete_video(video_ref: str):
    deleted = unregister_video_ref(video_ref)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Unknown videoRef: {video_ref}")
    return {"deleted": True}
