"""Stop owned native services if the Electron main process disappears."""

import os
import sys
import threading


def watch_parent():
    if os.environ.get("ANNOTATE_PARENT_PIPE") != "1":
        return

    def wait_for_close():
        # Only native launch enables this and supplies a dedicated stdin pipe.
        sys.stdin.buffer.read()
        try:
            import psutil
            children = psutil.Process().children(recursive=True)
            for child in children:
                try:
                    child.terminate()
                except psutil.NoSuchProcess:
                    pass
            _, alive = psutil.wait_procs(children, timeout=2)
            for child in alive:
                try:
                    child.kill()
                except psutil.NoSuchProcess:
                    pass
        finally:
            os._exit(0)

    threading.Thread(target=wait_for_close, name="desktop-parent", daemon=True).start()
