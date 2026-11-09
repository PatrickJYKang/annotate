"""Process-local all-player passes. Only detector results, never pixels, are spooled."""

from collections import OrderedDict
from contextlib import contextmanager
import pickle
from tempfile import TemporaryFile
from threading import Condition, Lock, Thread


class FrameSpool:
    def __init__(self):
        self.condition = Condition()
        # Private anonymous file: no external or project-supplied pickle is ever read.
        self.file = TemporaryFile()
        self.offsets = []
        self.finished = False
        self.error = None
        self.readers = 0
        self.retired = False

    def publish(self, frame):
        with self.condition:
            if self.retired:
                return True
            offset = self.file.seek(0, 2)
            pickle.dump(frame, self.file, protocol=5)
            self.offsets.append(offset)
            self.condition.notify_all()
            return False

    def get(self, index, wait=True):
        with self.condition:
            if wait:
                self.condition.wait_for(lambda: len(self.offsets) > index or self.finished or self.retired)
            if 0 <= index < len(self.offsets):
                self.file.seek(self.offsets[index])
                return pickle.load(self.file)
            if self.error:
                raise RuntimeError(self.error)
            return None

    def build(self, producer):
        try:
            producer(self.publish)
        except Exception as error:
            with self.condition:
                self.error = str(error) or type(error).__name__
        finally:
            with self.condition:
                self.finished = True
                self.condition.notify_all()


class ClipTrackCache:
    def __init__(self, capacity=2):
        self.lock = Lock()
        self.entries = OrderedDict()
        self.capacity = capacity

    @contextmanager
    def open(self, key, producer):
        with self.lock:
            entry = self.entries.get(key)
            if entry is None or entry.error:
                if key not in self.entries and len(self.entries) >= self.capacity:
                    victim = next((k for k,v in self.entries.items() if not v.readers), None)
                    if victim is None:
                        raise RuntimeError("Other clips are still being tracked. Try again when one finishes.")
                    old = self.entries.pop(victim)
                    with old.condition:
                        old.retired = True
                        old.condition.notify_all()
                entry = self.entries[key] = FrameSpool()
                Thread(target=entry.build, args=(producer,), daemon=True, name="annotate-clip-tracks").start()
            self.entries.move_to_end(key)
            entry.readers += 1
        try:
            yield entry
        finally:
            with self.lock:
                entry.readers -= 1

    def peek(self, key, index):
        with self.lock:
            entry = self.entries.get(key)
        return entry.get(index, wait=False) if entry and not entry.error else None
