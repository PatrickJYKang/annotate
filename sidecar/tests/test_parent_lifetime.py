import os
import subprocess
import sys


def test_desktop_parent_pipe_closure_stops_sidecar():
    process = subprocess.Popen(
        [sys.executable, '-u', '-c', 'from annotate_sidecar.parent_lifetime import watch_parent; import time; watch_parent(); print("ready", flush=True); time.sleep(60)'],
        env={**os.environ, 'ANNOTATE_PARENT_PIPE': '1'},
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    try:
        assert process.stdout.readline().strip() == b'ready'
        assert process.poll() is None
        process.stdin.close()
        assert process.wait(timeout=10) == 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def test_browser_sidecar_does_not_depend_on_stdin():
    result = subprocess.run(
        [sys.executable, '-c', 'from annotate_sidecar.parent_lifetime import watch_parent; watch_parent(); print("browser")'],
        env={**os.environ, 'ANNOTATE_PARENT_PIPE': '0'},
        stdin=subprocess.DEVNULL, capture_output=True, timeout=10,
    )
    assert result.returncode == 0
    assert result.stdout.strip() == b'browser'
