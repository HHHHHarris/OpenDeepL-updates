"""Isolated per-user Windows llama.cpp router for OpenDeepL.

No install, service, scheduled task, firewall, or global environment changes.
Usage: python windows_engine.py start|status|stop
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.environ.get('OPENDEEPL_CORE_ROOT') or str(Path(__file__).resolve().parents[1]))
from core.model_lifecycle import (PORT, QUALITY_ALIAS, RUNTIME, PRESET, QUALITY,
                                  TEMPLATE, write_preset, preset_identity)

ALIAS = QUALITY_ALIAS
ROOT = RUNTIME
BINARY = Path(os.environ.get('OPENDEEPL_LLAMA_SERVER') or ROOT / 'llama' / 'llama-server.exe')
MODEL = QUALITY
PID_FILE = ROOT / "dual-server.pid.json"
LOG = ROOT / "dual-server.log"
LOCK = ROOT / "dual-lifecycle.lock"


def _process(pid: int) -> dict | None:
    """Query creation time and command line of a specific Windows process."""
    script = ("$p=Get-CimInstance Win32_Process -Filter 'ProcessId=%d' -ErrorAction SilentlyContinue; "
              "if($p){[pscustomobject]@{path=$p.ExecutablePath;cmd=$p.CommandLine;created=$p.CreationDate.ToString('o')}|ConvertTo-Json -Compress}") % pid
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                            capture_output=True, text=True, timeout=10)
    if result.returncode or not result.stdout.strip():
        return None
    return json.loads(result.stdout)


def _listener_pid() -> int | None:
    script = ("Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort %d -State Listen "
              "-ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess") % PORT
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                            capture_output=True, text=True, timeout=10)
    try:
        return int(result.stdout.strip())
    except ValueError:
        return None


def _record() -> dict | None:
    try:
        return json.loads(PID_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _owned_pid() -> int | None:
    record = _record()
    if not record:
        return None
    try:
        pid = int(record["pid"])
        proc = _process(pid)
        if not proc:
            return None
        if (Path(proc["path"]).resolve() != BINARY.resolve()
                or proc["created"] != record["created"]
                or str(PRESET).lower() not in proc["cmd"].lower()
                or f"--port {PORT}" not in proc["cmd"]):
            return None
        return pid
    except (KeyError, ValueError, OSError, TypeError):
        return None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _models() -> dict | None:
    # Fixed loopback target, explicit no-proxy transport, and no redirects.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    try:
        with opener.open(f"http://127.0.0.1:{PORT}/v1/models", timeout=2) as response:
            return json.load(response)
    except (OSError, ValueError):
        return None


def _status() -> dict:
    pid = _owned_pid()
    listener = _listener_pid()
    if listener is not None and listener != pid:
        return {"state": "unmanaged-listener", "listener_pid": listener, "managed_pid": pid}
    data = _models() if pid and listener == pid else None
    if data:
        for item in data.get("data", []):
            if item.get("id") == ALIAS:
                raw = item.get("status", {})
                return {"state": raw.get("value", "ready") if isinstance(raw, dict) else raw,
                        "pid": pid, "endpoint": f"http://127.0.0.1:{PORT}"}
        return {"state": "ready-no-model", "pid": pid}
    return {"state": "starting" if pid else "offline", "pid": pid}


def _write_preset() -> None:
    write_preset()


def start() -> dict:
    before = _status()
    if before["state"] == "unmanaged-listener":
        raise RuntimeError(f"Port {PORT} belongs to another process; preserved.")
    if before["state"] not in ("offline", "starting"):
        if (_record() or {}).get("configuration") == preset_identity():
            return before
        stop()
    if before["state"] == "starting":
        raise RuntimeError("Managed router is already starting.")
    for path in (BINARY, MODEL, TEMPLATE):
        if not path.is_file():
            raise RuntimeError(f"Missing isolated runtime file: {path}")
    if MODEL.stat().st_size != 7981928896:
        raise RuntimeError("Model byte length differs from verified source.")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", PORT))
    _write_preset()
    args = [str(BINARY), "--models-preset", str(PRESET), "--models-max", "1",
            "--host", "127.0.0.1", "--port", str(PORT), "--offline", "--ctx-size", "8192",
            "--parallel", "1", "--n-predict", "4096", "--gpu-layers", "0",
            "--batch-size", "512", "--ubatch-size", "256",
            "--jinja",
            "--temp", "0", "--top-k", "20", "--top-p", "0.6", "--repeat-penalty", "1.05",
            "--no-webui", "--no-slots", "--cors-origins", "localhost", "--no-cors-credentials",
            "--sleep-idle-seconds", "60", "--log-verbosity", "2"]
    # OpenSSH on Windows places remote child processes in its job; even DETACHED_PROCESS
    # is terminated when the SSH command exits. Win32_Process.Create makes a per-user
    # process via WMI without installing a task/service or touching other processes.
    args += ["--log-file", str(LOG)]
    command = subprocess.list2cmdline(args).replace("'", "''")
    directory = str(ROOT).replace("'", "''")
    script = ("$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create "
              "-Arguments @{CommandLine='%s';CurrentDirectory='%s'}; "
              "[pscustomobject]@{pid=$r.ProcessId;result=$r.ReturnValue}|ConvertTo-Json -Compress") % (command, directory)
    import base64
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    launched = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                              capture_output=True, text=True, timeout=20)
    if launched.returncode:
        raise RuntimeError("WMI launch failed: " + launched.stderr.strip())
    launch_info = json.loads(launched.stdout)
    if launch_info.get("result") != 0 or not launch_info.get("pid"):
        raise RuntimeError("WMI launch returned " + str(launch_info))
    pid = int(launch_info["pid"])
    proc = None
    for _ in range(40):
        proc = _process(pid)
        if proc:
            break
        time.sleep(.1)
    if not proc:
        raise RuntimeError("Launched server process vanished; inspect server.log.")
    PID_FILE.write_text(json.dumps({"pid": pid, "created": proc["created"], "configuration": preset_identity()}), encoding="utf-8")
    for _ in range(600):
        if _process(pid) is None:
            PID_FILE.unlink(missing_ok=True)
            raise RuntimeError("Server exited; inspect server.log.")
        status = _status()
        if status["state"] not in ("offline", "starting", "unmanaged-listener"):
            return status
        time.sleep(.2)
    raise RuntimeError("Server startup timed out; process was left for inspection.")


def stop() -> dict:
    pid = _owned_pid()
    if pid is None:
        return {"state": "no-managed-process", "listener_pid": _listener_pid()}
    # Kill only the exact launch identity stored by this script. Never kill descendants or a port owner.
    result = subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"Own-process stop failed: {result.stderr.strip()}")
    for _ in range(30):
        if _owned_pid() is None:
            PID_FILE.unlink(missing_ok=True)
            return {"state": "stopped", "pid": pid}
        time.sleep(.2)
    raise RuntimeError("Stop requested; process identity still present.")


def main() -> int:
    if sys.platform != "win32":
        print("Windows runtime launcher requires win32.", file=sys.stderr)
        return 2
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    if action not in ("start", "status", "stop"):
        print("Usage: windows_engine.py start|status|stop", file=sys.stderr)
        return 2
    ROOT.mkdir(parents=True, exist_ok=True)
    if action == "status":
        print(json.dumps(_status()))
        return 0
    # msvcrt byte-range lock stays held through start/stop, nonblocking across processes.
    import msvcrt
    with LOCK.open("a+b") as lock:
        lock.seek(0)
        lock.write(b"0")
        lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            print("Another lifecycle operation is in progress.", file=sys.stderr)
            return 1
        try:
            print(json.dumps(start() if action == "start" else stop()))
            return 0
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
            print(str(exc), file=sys.stderr)
            return 1
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


if __name__ == "__main__":
    raise SystemExit(main())
