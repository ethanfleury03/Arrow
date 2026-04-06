from __future__ import annotations

import json
import os
import shlex
import subprocess
import tempfile
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

from board_compositor import BoardCompositor, PDFPlacement, composite_board_job


MAX_LOG_TAIL = 200
DEFAULT_PES_IP = "192.168.100.200"
DEFAULT_PES_PORT = "13001"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobRequest(BaseModel):
    input_path: str = Field(..., min_length=1)
    args: List[str] = Field(default_factory=list)
    env: Dict[str, str] = Field(default_factory=dict)

    @field_validator("input_path")
    @classmethod
    def _path_exists(cls, value: str) -> str:
        if not Path(value).exists():
            raise ValueError(f"input_path does not exist: {value}")
        return value


class PDFPlacementRequest(BaseModel):
    """A PDF placed on the board."""
    pdf_path: str = Field(..., min_length=1)
    x_inches: float = Field(default=0.0, ge=0)
    y_inches: float = Field(default=0.0, ge=0)
    scale: float = Field(default=1.0, gt=0, le=10)
    rotation_degrees: float = Field(default=0.0, ge=-360, le=360)
    page_number: int = Field(default=0, ge=0)  # 0 = all pages

    @field_validator("pdf_path")
    @classmethod
    def _path_exists(cls, value: str) -> str:
        if not Path(value).exists():
            raise ValueError(f"pdf_path does not exist: {value}")
        return value


class BoardJobRequest(BaseModel):
    """A board composition job - multiple PDFs on a single board."""
    board_width_inches: float = Field(..., gt=0, le=100)
    board_height_inches: float = Field(..., gt=0, le=100)
    placements: List[PDFPlacementRequest] = Field(..., min_length=1)
    args: List[str] = Field(default_factory=list)
    env: Dict[str, str] = Field(default_factory=dict)


class JobState(BaseModel):
    id: str
    status: str
    created_at: str
    updated_at: str
    payload: Dict[str, Any]
    events: List[Dict[str, Any]]
    logs_tail: List[str]
    exit_code: Optional[int] = None
    error_code: Optional[str] = None


app = FastAPI(title="RIP Adapter Service", version="0.1.0")
_jobs: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()


def _repo_root() -> Path:
    override = os.getenv("ARROW_ROOT", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    # rip-core/adapter/service.py -> repo root is ../..
    return Path(__file__).resolve().parents[2]


def _default_command() -> List[str]:
    raw = os.getenv("RIP_COMMAND", "").strip()
    if raw:
        return shlex.split(raw)

    root = _repo_root()
    candidates = [
        root / "rip-core" / "src" / "build" / "memjet-rip",
        root / "src" / "build" / "memjet-rip",  # when running from rip-core as root
    ]

    for candidate in candidates:
        if candidate.exists():
            return [str(candidate)]

    # final fallback preserves old behavior for local dev/debug
    return ["./src/build/memjet-rip"]


def _append_log(job: Dict[str, Any], line: str) -> None:
    logs = job.setdefault("logs_tail", deque(maxlen=MAX_LOG_TAIL))
    logs.append(line.rstrip("\n"))


def _has_arg(args: List[str], flag: str) -> bool:
    return any(a == flag or a.startswith(f"{flag}=") for a in args)


def _resolve_default_pes_ip() -> str:
    for key in ("RIP_DEFAULT_PES_IP", "RIP_PES_IP", "PES_IP"):
        value = os.getenv(key, "").strip()
        if value:
            return value
    return DEFAULT_PES_IP


def _resolve_default_pes_port() -> str:
    for key in ("RIP_DEFAULT_PES_PORT", "RIP_PES_PORT", "PES_PORT"):
        value = os.getenv(key, "").strip()
        if value:
            return value
    return DEFAULT_PES_PORT


def _transition(job: Dict[str, Any], status: str, event: Optional[Dict[str, Any]] = None) -> None:
    job["status"] = status
    job["updated_at"] = _utc_now()
    if event:
        job.setdefault("events", []).append(event)


def _consume_line(job: Dict[str, Any], line: str) -> None:
    _append_log(job, line)
    stripped = line.strip()
    if not stripped.startswith("{"):
        return
    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError:
        return

    job.setdefault("events", []).append(payload)
    event = payload.get("event")
    if event == "rip.job.created":
        _transition(job, "preparing")
    elif event == "rip.completed":
        _transition(job, "completed")
    elif event == "rip.failed":
        _transition(job, "failed")
    if payload.get("error_code"):
        job["error_code"] = str(payload["error_code"])


def _stream_reader(stream, job_id: str) -> None:
    """Read lines from a subprocess stream and feed them into the job log.

    Runs in a dedicated thread so stdout and stderr are consumed
    concurrently, preventing pipe-buffer deadlocks.
    """
    try:
        for line in stream:
            with _lock:
                job = _jobs[job_id]
                _consume_line(job, line)
    except ValueError:
        pass
    finally:
        try:
            stream.close()
        except Exception:
            pass


def _run_job(job_id: str, command: List[str], env_overrides: Dict[str, str]) -> None:
    with _lock:
        job = _jobs[job_id]
        _transition(job, "running")

    env = os.environ.copy()
    env.update(env_overrides)

    try:
        proc = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
    except Exception as exc:
        with _lock:
            job = _jobs[job_id]
            job["exit_code"] = -1
            job["error_code"] = "RIP_RUNTIME_EXCEPTION"
            _transition(job, "failed", {"event": "rip.failed", "message": str(exc), "error_code": "RIP_RUNTIME_EXCEPTION"})
        return

    assert proc.stdout is not None
    assert proc.stderr is not None

    stdout_thread = threading.Thread(target=_stream_reader, args=(proc.stdout, job_id), daemon=True)
    stderr_thread = threading.Thread(target=_stream_reader, args=(proc.stderr, job_id), daemon=True)
    stdout_thread.start()
    stderr_thread.start()

    stdout_thread.join()
    stderr_thread.join()

    exit_code = proc.wait()
    with _lock:
        job = _jobs[job_id]
        job["exit_code"] = int(exit_code)
        if job["status"] not in {"completed", "failed"}:
            if exit_code == 0:
                _transition(job, "completed", {"event": "rip.completed"})
            else:
                job["error_code"] = job.get("error_code") or "RIP_RUNTIME_EXCEPTION"
                _transition(job, "failed", {"event": "rip.failed", "error_code": job["error_code"]})


def start_job(job_id: str, payload: JobRequest) -> List[str]:
    args = list(payload.args)

    if not _has_arg(args, "--dry-run"):
        if not _has_arg(args, "--pes-ip"):
            args.extend(["--pes-ip", _resolve_default_pes_ip()])
        if not _has_arg(args, "--pes-port"):
            args.extend(["--pes-port", _resolve_default_pes_port()])

    command = _default_command() + [payload.input_path] + args
    thread = threading.Thread(target=_run_job, args=(job_id, command, payload.env), daemon=True)
    thread.start()
    return command


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "service": "rip-adapter", "time": _utc_now()}


@app.post("/jobs/board", status_code=202)
def submit_board_job(request: BoardJobRequest) -> Dict[str, Any]:
    """
    Submit a board composition job.

    Multiple PDFs are composited onto a single board page before RIP processing.
    This mimics commercial RIP "board" or "page" workflow.

    The board is defined by width x height in inches. Each PDF is placed at
    specified x,y coordinates with optional scale and rotation.
    """
    job_id = str(uuid.uuid4())
    now = _utc_now()

    # Build the composite PDF
    placement_dicts = [
        {
            "pdf_path": p.pdf_path,
            "x_inches": p.x_inches,
            "y_inches": p.y_inches,
            "scale": p.scale,
            "rotation_degrees": p.rotation_degrees,
            "page_number": p.page_number
        }
        for p in request.placements
    ]

    try:
        # Create composite PDF
        composite_path = composite_board_job(
            board_width_inches=request.board_width_inches,
            board_height_inches=request.board_height_inches,
            placements=placement_dicts
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Board composition failed: {exc}") from exc

    # Create a JobRequest from the composite
    job_request = JobRequest(
        input_path=composite_path,
        args=request.args,
        env=request.env
    )

    entry = {
        "id": job_id,
        "status": "queued",
        "created_at": now,
        "updated_at": now,
        "payload": {
            "type": "board",
            "board_width_inches": request.board_width_inches,
            "board_height_inches": request.board_height_inches,
            "placements": [p.model_dump() for p in request.placements],
            "composite_path": composite_path,
            "args": request.args,
        },
        "events": [],
        "logs_tail": deque(maxlen=MAX_LOG_TAIL),
        "exit_code": None,
        "error_code": None,
    }
    with _lock:
        _jobs[job_id] = entry

    try:
        command = start_job(job_id, job_request)
    except Exception as exc:
        with _lock:
            job = _jobs[job_id]
            job["status"] = "failed"
            job["updated_at"] = _utc_now()
            job["error_code"] = "RIP_RUNTIME_EXCEPTION"
            job["events"].append({"event": "rip.failed", "error_code": "RIP_RUNTIME_EXCEPTION", "message": str(exc)})
        raise HTTPException(status_code=500, detail="Failed to launch RIP process") from exc

    return {"id": job_id, "status": "queued", "command": command, "composite_path": composite_path}


@app.post("/jobs", status_code=202)
def submit_job(request: JobRequest) -> Dict[str, Any]:
    job_id = str(uuid.uuid4())
    now = _utc_now()
    entry = {
        "id": job_id,
        "status": "queued",
        "created_at": now,
        "updated_at": now,
        "payload": request.model_dump(),
        "events": [],
        "logs_tail": deque(maxlen=MAX_LOG_TAIL),
        "exit_code": None,
        "error_code": None,
    }
    with _lock:
        _jobs[job_id] = entry

    try:
        command = start_job(job_id, request)
    except Exception as exc:
        with _lock:
            job = _jobs[job_id]
            job["status"] = "failed"
            job["updated_at"] = _utc_now()
            job["error_code"] = "RIP_RUNTIME_EXCEPTION"
            job["events"].append({"event": "rip.failed", "error_code": "RIP_RUNTIME_EXCEPTION", "message": str(exc)})
        raise HTTPException(status_code=500, detail="Failed to launch RIP process") from exc

    return {"id": job_id, "status": "queued", "command": command}


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> JobState:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        copy = dict(job)
        copy["logs_tail"] = list(copy.get("logs_tail", []))
    return JobState(**copy)
