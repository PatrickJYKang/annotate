"""Read-only comparison of the installed media tools and a source-built candidate.

Run with Annotate's bundled python.exe; no Python installation is required.
Creates only a new diagnostics directory. It never installs or replaces files.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import traceback


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--start", type=float, default=600)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("Run this check on Windows; another operating system cannot certify it.")
    output = Path(tempfile.mkdtemp(prefix="Annotate-media-check-", dir=args.output))
    report = {"schema": 1, "platform": sys.platform, "checks": [], "passed": False}
    log = (output / "commands.log").open("w", encoding="utf-8")
    print(f"Results will be saved in: {output}", flush=True)

    def run(command, *, binary=False, timeout=180):
        command = [str(part) for part in command]
        log.write(json.dumps(command) + "\n")
        log.flush()
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
        log.write(result.stderr.decode("utf-8", errors="replace") + "\n")
        log.flush()
        if result.returncode:
            raise RuntimeError(f"Command failed ({result.returncode}): {command[0]}\n{result.stderr[-6000:].decode(errors='replace')}")
        return result.stdout if binary else result.stdout.decode("utf-8", errors="replace")

    def record(name, action):
        print(name, flush=True)
        started = time.monotonic()
        detail = action()
        report["checks"].append({"name": name, "passed": True, "seconds": time.monotonic() - started, "detail": detail})
        (output / "results.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    old = args.runtime.resolve() / "ffmpeg/bin/ffmpeg.exe"
    new = args.candidate.resolve() / "bin/ffmpeg.exe"
    probe = args.candidate.resolve() / "bin/ffprobe.exe"
    try:
        if not all(p.is_file() for p in [old, new, probe, args.video]):
            raise RuntimeError("The original app, candidate tools or selected video could not be found.")
        report["binaries"] = []
        for file in [old, new, probe]:
            with file.open("rb") as stream:
                report["binaries"].append({"name": str(file), "sha256": hashlib.file_digest(stream, "sha256").hexdigest()})
        record("Check both media tools start", lambda: {"original": run([old, "-version"]), "candidate": run([new, "-version"])})
        def probe_video(video):
            return json.loads(run([probe, "-v", "error", "-show_streams", "-show_format", "-of", "json", video]))
        metadata = probe_video(args.video)
        duration = float(metadata["format"]["duration"])
        start = max(0, min(args.start, duration - 3))
        def decoded(tool, video, at=0):
            return run([tool, "-v", "error", "-threads", "2", "-ss", str(at), "-i", video, "-map", "0:v:0", "-frames:v", "20", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], binary=True)
        def parity(video, at=0):
            before, after = decoded(old, video, at), decoded(new, video, at)
            if not before or before != after:
                raise RuntimeError(f"Decoded video differs: {video.name}")
            return {"bytes": len(after), "sha256": hashlib.sha256(after).hexdigest()}
        record("Compare actual football frames", lambda: parity(args.video, start))
        for codec, ext, options in [
            ("mpeg4", "avi", []), ("libx265", "mp4", ["-preset", "ultrafast"]),
            ("libvpx-vp9", "webm", ["-deadline", "realtime", "-cpu-used", "8"]),
            ("libaom-av1", "mkv", ["-cpu-used", "8"]), ("ffv1", "mkv", []),
        ]:
            fixture = output / f"decode-{codec}.{ext}"
            def check_codec(codec=codec, options=options, fixture=fixture):
                run([old, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x96:rate=10", "-t", "0.5", "-c:v", codec, "-threads", "2", *options, fixture])
                return parity(fixture)
            record(f"Compare {codec} import decoding", check_codec)
        normalized = output / "normalized.mp4"
        def normalize():
            run([new, "-v", "error", "-ss", str(start), "-i", args.video, "-t", "2", "-vf", "fps=25,scale=640:360,setsar=1", "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", normalized])
            info = probe_video(normalized)
            stream = next(s for s in info["streams"] if s["codec_type"] == "video")
            assert stream["width"] == 640 and stream["height"] == 360 and stream["avg_frame_rate"] == "25/1"
            assert int(stream["nb_frames"]) == 50
            assert not any(s["codec_type"] == "audio" for s in metadata["streams"]) or any(s["codec_type"] == "audio" for s in info["streams"])
            return info
        record("Import normalization, audio and frame count", normalize)
        def export():
            run([new, "-v", "error", "-i", normalized, "-frames:v", "10", output / "frame-%04d.png"])
            movie = output / "annotated-export.mp4"
            run([new, "-v", "error", "-framerate", "25", "-i", output / "frame-%04d.png", "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", movie])
            info = probe_video(movie)
            assert int(info["streams"][0]["nb_frames"]) == 10
            return info
        record("PNG frame sequence and H.264 export", export)
        def geometry():
            import shapely
            from shapely.geometry import Point, Polygon
            assert Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]).contains(Point(0.5, 0.5))
            return {"shapely": shapely.__version__, "geos": shapely.geos_version_string}
        record("Bundled geometry library loads", geometry)
        report["passed"] = True
        report["remaining"] = ["Install/uninstall UI", "Full Electron editing/presentation smoke", "Modified-library replacement on Windows"]
        print("Media comparison passed. Keep results.json and commands.log.", flush=True)
        return 0
    except Exception:
        report["error"] = traceback.format_exc()
        print(report["error"], flush=True)
        return 1
    finally:
        (output / "results.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        log.close()
        print(f"Report: {output / 'results.json'}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
