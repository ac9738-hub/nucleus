"""Progress reporting for parse trial arms (terminal + log file)."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any


class TrialProgress:
    def __init__(
        self,
        placement: str,
        total_items: int,
        *,
        log_path: Path | str | None = None,
    ) -> None:
        self.placement = placement
        self.total_items = max(0, int(total_items))
        self.log_path = Path(log_path) if log_path else None
        self.started = time.perf_counter()
        self.phase = 'starting'
        self.done_items = 0
        if self.log_path:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)

    def _elapsed(self) -> str:
        seconds = int(time.perf_counter() - self.started)
        minutes, sec = divmod(seconds, 60)
        hours, minutes = divmod(minutes, 60)
        if hours:
            return f'{hours}h{minutes:02d}m{sec:02d}s'
        return f'{minutes}m{sec:02d}s'

    def percent(self) -> float:
        if self.total_items <= 0:
            return 100.0 if self.phase == 'done' else 0.0
        if self.phase in {'merging', 'dedup_pre', 'dedup_finalize', 'postprocess', 'done'}:
            base = 100.0
        elif self.phase == 'invoking':
            base = min(5.0, 100.0 * self.done_items / self.total_items)
        else:
            base = 100.0 * self.done_items / self.total_items
        return min(100.0, max(0.0, base))

    def snapshot(self) -> dict[str, Any]:
        return {
            'placement': self.placement,
            'phase': self.phase,
            'done_items': self.done_items,
            'total_items': self.total_items,
            'percent': round(self.percent(), 1),
            'elapsed': self._elapsed(),
            'updated_at': time.time(),
        }

    def set_phase(self, phase: str, *, done: int | None = None) -> None:
        self.phase = phase
        if done is not None:
            self.done_items = done
        self.emit()

    def tick(self, done: int, *, phase: str | None = None) -> None:
        self.done_items = done
        if phase:
            self.phase = phase
        self.emit()

    def emit(self, extra: str = '') -> None:
        snap = self.snapshot()
        line = (
            f"[{snap['percent']:5.1f}%] {self.placement} | "
            f"{snap['done_items']}/{snap['total_items']} items | "
            f"phase={snap['phase']} | elapsed={snap['elapsed']}"
        )
        if extra:
            line = f'{line} | {extra}'
        print(line, flush=True)
        sys.stdout.flush()
        if self.log_path:
            payload = {**snap, 'message': line}
            self.log_path.write_text(json.dumps(payload, indent=2), encoding='utf-8')
