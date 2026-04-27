#!/usr/bin/env python3
"""
Backend server for Agent Chat — provides:
  1. WebSocket terminal server (default port 8765)
  2. ADB bridge HTTP server   (default port 8080)

Usage:
  pip install -r requirements.txt
  python server.py

Options (environment variables):
  TERMINAL_PORT  — WebSocket terminal port (default: 8765)
  ADB_PORT       — ADB bridge HTTP port    (default: 8080)
  SHELL          — Shell to spawn           (default: /bin/bash)
"""

import asyncio
import base64
import fcntl
import json
import logging
import os
import pty
import shutil
import signal
import struct
import subprocess
import sys
import termios
import base64
from io import BytesIO
from PIL import Image

from aiohttp import web
import websockets

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TERMINAL_PORT = int(os.environ.get("TERMINAL_PORT", "8765"))
CLAUDE_CODE_PORT = int(os.environ.get("CLAUDE_CODE_PORT", "8766"))
ADB_PORT = int(os.environ.get("ADB_PORT", "8080"))
SHELL = os.environ.get("SHELL", "/bin/bash")
# Bind to localhost by default for security; set to 0.0.0.0 for remote access
BIND_HOST = os.environ.get("BIND_HOST", "0.0.0.0")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("server")

# ---------------------------------------------------------------------------
# Helper: find adb binary
# ---------------------------------------------------------------------------
def _adb_bin():
    path = shutil.which("adb")
    if path is None:
        raise FileNotFoundError(
            "adb not found in PATH. Install Android SDK platform-tools."
        )
    return path

# ---------------------------------------------------------------------------
# Helper: run adb command safely (no shell=True)
# ---------------------------------------------------------------------------
async def _run_adb(*args, binary=False):
    """Run an adb sub-command and return stdout (text or bytes)."""
    adb = _adb_bin()
    cmd = [adb] + list(args)
    log.info("adb: %s", " ".join(cmd))
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(stderr.decode(errors="replace").strip() or f"adb command failed with exit code {proc.returncode}")
    return stdout if binary else stdout.decode(errors="replace")

# ---------------------------------------------------------------------------
# ADB Bridge — HTTP handlers
# ---------------------------------------------------------------------------
# Allow requests from common local development origins
ALLOWED_ORIGINS = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://0.0.0.0:5173,http://localhost:3000,http://127.0.0.1:3000,http://0.0.0.0:3000",
).split(",")


def _cors_headers(request):
    origin = request.headers.get("Origin", "")
    # When binding to 0.0.0.0, also allow the requesting origin for external device access
    if BIND_HOST == "0.0.0.0" and origin:
        allow_origin = origin
    else:
        allow_origin = origin if origin in ALLOWED_ORIGINS else ALLOWED_ORIGINS[0]
    return {
        "Access-Control-Allow-Origin": allow_origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }


def _json_response(data, status=200, *, request=None):
    headers = _cors_headers(request) if request else {
        "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0],
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }
    return web.json_response(data, status=status, headers=headers)

def _error_response(msg, status=500, *, request=None):
    return _json_response({"error": msg}, status=status, request=request)

async def handle_options(request):
    """Handle CORS preflight."""
    return web.Response(status=204, headers=_cors_headers(request))

async def handle_devices(request):
    try:
        out = await _run_adb("devices")
        lines = out.strip().splitlines()[1:]  # skip header
        devices = []
        for line in lines:
            parts = line.split("\t")
            if len(parts) >= 2:
                devices.append({"id": parts[0], "status": parts[1]})
        return _json_response({"devices": devices}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

def _resize_png_bytes_if_needed(png_bytes: bytes, max_side: int = 2048) -> tuple[bytes, float]:
    with Image.open(BytesIO(png_bytes)) as img:
        w, h = img.size
        # 如果不需要缩放，比例是 1.0
        if w <= max_side and h <= max_side:
            return png_bytes, 1.0

        # 计算缩放比例
        scale = min(max_side / w, max_side / h)
        nw, nh = int(w * scale), int(h * scale)

        resized = img.resize((nw, nh), Image.LANCZOS).convert("RGB")

        out = BytesIO()
        resized.save(out, format="JPEG", quality=85, optimize=True)
        # 返回图片数据和比例
        return out.getvalue(), scale

async def handle_screenshot(request):
    try:
        raw = await _run_adb("exec-out", "screencap", "-p", binary=True)
        # 解构获取数据和比例
        processed, scale = _resize_png_bytes_if_needed(raw, max_side=2048)
        b64 = base64.b64encode(processed).decode("ascii")
        # 在 JSON 中附带 scale 信息
        return _json_response({"image": b64, "scale": scale}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

async def handle_click(request):
    try:
        body = await request.json()
        x = int(body["x"])
        y = int(body["y"])
        # 获取前端传来的缩放比例，默认为 1.0（防止旧前端没传）
        scale = float(body.get("scale", 1.0))
        
        # 关键步骤：反向计算真实坐标
        # 屏幕真实坐标 = 前端点击坐标 / 缩放比例
        real_x = int(x / scale)
        real_y = int(y / scale)

        await _run_adb("shell", "input", "tap", str(real_x), str(real_y))
        return _json_response({"ok": True}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

async def handle_swipe(request):
    try:
        body = await request.json()
        x1 = int(body["x1"])
        y1 = int(body["y1"])
        x2 = int(body["x2"])
        y2 = int(body["y2"])
        duration = int(body.get("duration", 300))
        await _run_adb(
            "shell", "input", "swipe",
            str(x1), str(y1), str(x2), str(y2), str(duration),
        )
        return _json_response({"ok": True}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

async def handle_keyevent(request):
    try:
        body = await request.json()
        keycode = int(body["keycode"])
        await _run_adb("shell", "input", "keyevent", str(keycode))
        return _json_response({"ok": True}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

async def handle_input_text(request):
    try:
        body = await request.json()
        text = str(body["text"])
        await _run_adb("shell", "input", "text", text)
        return _json_response({"ok": True}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

async def handle_keyboard_input(request):
    """Input text via ADB Keyboard broadcast (supports CJK and special characters)."""
    try:
        body = await request.json()
        text = str(body["text"])
        await _run_adb(
            "shell", "am", "broadcast",
            "-a", "ADB_INPUT_TEXT",
            "--es", "msg", text,
        )
        return _json_response({"ok": True}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

# ---------------------------------------------------------------------------
# Scrcpy / Real-time Screen Streaming via WebSocket
# ---------------------------------------------------------------------------

# Global state for scrcpy recording process
_scrcpy_record_proc = None
_scrcpy_record_file = None


async def handle_scrcpy_stream(request):
    """WebSocket endpoint for continuous screen frame streaming.

    Uses ``adb exec-out screencap -p`` in a tight loop to deliver PNG frames
    as base64-encoded JSON messages, emulating scrcpy real-time mirroring.

    Each message: {"frame": "<base64>", "fps": <float>, "frameNumber": <int>,
                   "width": <int>, "height": <int>}
    """
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    log.info("Scrcpy stream client connected")
    frame_count = 0
    start_time = asyncio.get_event_loop().time()
    target_fps = 10  # limit to ~10 fps to avoid overwhelming device/network
    frame_interval = 1.0 / target_fps

    try:
        while not ws.closed:
            frame_start = asyncio.get_event_loop().time()
            try:
                raw = await _run_adb("exec-out", "screencap", "-p", binary=True)
                b64 = base64.b64encode(raw).decode("ascii")
                frame_count += 1
                elapsed = asyncio.get_event_loop().time() - start_time
                current_fps = frame_count / elapsed if elapsed > 0 else 0

                # Try to read PNG dimensions from IHDR chunk (bytes 16-24)
                width, height = 0, 0
                try:
                    if raw[:8] == b'\x89PNG\r\n\x1a\n':
                        width = struct.unpack('>I', raw[16:20])[0]
                        height = struct.unpack('>I', raw[20:24])[0]
                except Exception:
                    pass

                await ws.send_json({
                    "frame": b64,
                    "fps": round(current_fps, 1),
                    "frameNumber": frame_count,
                    "width": width,
                    "height": height,
                })
            except Exception as e:
                await ws.send_json({"error": str(e)})
                await asyncio.sleep(1)

            # Rate-limit: sleep to maintain target FPS
            frame_elapsed = asyncio.get_event_loop().time() - frame_start
            sleep_time = frame_interval - frame_elapsed
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)

            # Check for incoming control messages (non-blocking)
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=0.05)
                if msg.type == web.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    if data.get("action") == "stop":
                        break
                elif msg.type in (web.WSMsgType.CLOSE, web.WSMsgType.CLOSING, web.WSMsgType.CLOSED):
                    break
            except asyncio.TimeoutError:
                pass
    except Exception:
        pass
    finally:
        log.info("Scrcpy stream client disconnected (sent %d frames)", frame_count)

    return ws


async def handle_scrcpy_record_start(request):
    """Start screen recording using scrcpy --no-display -r <file>."""
    global _scrcpy_record_proc, _scrcpy_record_file
    if _scrcpy_record_proc is not None:
        return _error_response("Recording already in progress", request=request)

    try:
        scrcpy_bin = shutil.which("scrcpy")
        if not scrcpy_bin:
            raise FileNotFoundError("scrcpy not found in PATH. Install scrcpy first.")

        import tempfile
        record_file = os.path.join(
            tempfile.gettempdir(),
            f"phone-recording-{int(asyncio.get_event_loop().time())}.mp4",
        )
        _scrcpy_record_file = record_file
        _scrcpy_record_proc = await asyncio.create_subprocess_exec(
            scrcpy_bin, "--no-display", "-r", record_file,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        log.info("Scrcpy recording started: %s (pid=%d)", record_file, _scrcpy_record_proc.pid)
        return _json_response({"ok": True, "file": record_file}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)


async def handle_scrcpy_record_stop(request):
    """Stop scrcpy recording and return the file path."""
    global _scrcpy_record_proc, _scrcpy_record_file
    if _scrcpy_record_proc is None:
        return _error_response("No recording in progress", request=request)

    try:
        _scrcpy_record_proc.terminate()
        await _scrcpy_record_proc.wait()
        proc = _scrcpy_record_proc
        filepath = _scrcpy_record_file
        _scrcpy_record_proc = None
        _scrcpy_record_file = None
        log.info("Scrcpy recording stopped (pid=%d)", proc.pid)
        return _json_response({"ok": True, "file": filepath}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)


async def handle_screen_size(request):
    """Get device screen size and rotation info."""
    try:
        size_output = await _run_adb("shell", "wm", "size")
        rotation_output = await _run_adb(
            "shell", "dumpsys", "input",
        )
        # Parse 'Physical size: WIDTHxHEIGHT'
        width, height = 0, 0
        for line in size_output.strip().splitlines():
            if 'size' in line.lower():
                parts = line.split(':')
                if len(parts) >= 2:
                    dims = parts[-1].strip().split('x')
                    if len(dims) == 2:
                        width = int(dims[0])
                        height = int(dims[1])

        # Parse rotation from dumpsys
        rotation = 0
        for line in rotation_output.splitlines():
            if 'SurfaceOrientation' in line:
                try:
                    rotation = int(line.strip().split(':')[-1].strip()) * 90
                except (ValueError, IndexError):
                    pass
                break

        return _json_response({
            "width": width,
            "height": height,
            "rotation": rotation,
        }, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)


async def handle_list_dir(request):
    """List contents of a directory on the server filesystem."""
    try:
        dir_path = request.query.get("path", os.getcwd())
        # Resolve to real absolute path to prevent traversal
        dir_path = os.path.realpath(dir_path)
        if not os.path.isdir(dir_path):
            return _error_response("Not a directory", status=400, request=request)
        entries = []
        try:
            items = os.listdir(dir_path)
        except PermissionError:
            return _error_response("Permission denied", status=403, request=request)
        for name in sorted(items):
            full = os.path.join(dir_path, name)
            try:
                stat = os.stat(full)
                entries.append({
                    "name": name,
                    "type": "folder" if os.path.isdir(full) else "file",
                    "size": stat.st_size if os.path.isfile(full) else 0,
                })
            except (OSError, PermissionError):
                continue
        return _json_response({"path": dir_path, "entries": entries}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

# Maximum file size for reading (1MB)
MAX_READ_SIZE = 1 * 1024 * 1024

# Sensitive paths that should not be read
BLOCKED_PREFIXES = ("/etc/shadow", "/etc/gshadow", "/proc/", "/sys/")

async def handle_read_file(request):
    """Read contents of a file on the server filesystem."""
    try:
        file_path = request.query.get("path", "")
        if not file_path:
            return _error_response("path parameter is required", status=400, request=request)
        # Resolve to real absolute path to prevent traversal
        file_path = os.path.realpath(file_path)
        # Block access to sensitive system paths
        for prefix in BLOCKED_PREFIXES:
            if file_path.startswith(prefix):
                return _error_response("Access denied: restricted path", status=403, request=request)
        if not os.path.isfile(file_path):
            return _error_response("Not a file", status=400, request=request)
        file_size = os.path.getsize(file_path)
        if file_size > MAX_READ_SIZE:
            return _error_response(
                f"File too large ({file_size} bytes). Maximum is {MAX_READ_SIZE} bytes.",
                status=400,
                request=request,
            )
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except PermissionError:
            return _error_response("Permission denied", status=403, request=request)
        return _json_response({
            "path": file_path,
            "content": content,
            "size": file_size,
        }, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)


MAX_WRITE_SIZE = 1 * 1024 * 1024  # 1MB max write

async def handle_write_file(request):
    """Write contents to a file on the server filesystem."""
    try:
        body = await request.json()
        file_path = body.get("path", "")
        content = body.get("content", "")
        if not file_path:
            return _error_response("path is required", status=400, request=request)
        file_path = os.path.realpath(file_path)
        for prefix in BLOCKED_PREFIXES:
            if file_path.startswith(prefix):
                return _error_response("Access denied: restricted path", status=403, request=request)
        if len(content.encode("utf-8")) > MAX_WRITE_SIZE:
            return _error_response("Content too large", status=400, request=request)
        parent = os.path.dirname(file_path)
        if not os.path.isdir(parent):
            return _error_response("Parent directory does not exist", status=400, request=request)
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(content)
        except PermissionError:
            return _error_response("Permission denied", status=403, request=request)
        return _json_response({"path": file_path, "size": len(content.encode("utf-8")), "ok": True}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

async def handle_create_file(request):
    """Create a new file on the server filesystem."""
    try:
        body = await request.json()
        file_path = body.get("path", "")
        if not file_path:
            return _error_response("path is required", status=400, request=request)
        file_path = os.path.realpath(file_path)
        for prefix in BLOCKED_PREFIXES:
            if file_path.startswith(prefix):
                return _error_response("Access denied: restricted path", status=403, request=request)
        if os.path.exists(file_path):
            return _error_response("File already exists", status=400, request=request)
        parent = os.path.dirname(file_path)
        if not os.path.isdir(parent):
            return _error_response("Parent directory does not exist", status=400, request=request)
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                f.write("")
        except PermissionError:
            return _error_response("Permission denied", status=403, request=request)
        return _json_response({"path": file_path, "ok": True}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

async def handle_delete_file(request):
    """Delete a file or empty directory on the server filesystem."""
    try:
        body = await request.json()
        file_path = body.get("path", "")
        if not file_path:
            return _error_response("path is required", status=400, request=request)
        file_path = os.path.realpath(file_path)
        for prefix in BLOCKED_PREFIXES:
            if file_path.startswith(prefix):
                return _error_response("Access denied: restricted path", status=403, request=request)
        try:
            if os.path.isfile(file_path):
                os.remove(file_path)
            elif os.path.isdir(file_path):
                os.rmdir(file_path)
            else:
                return _error_response("Path not found", status=404, request=request)
        except PermissionError:
            return _error_response("Permission denied", status=403, request=request)
        except OSError as e:
            return _error_response(str(e), status=400, request=request)
        return _json_response({"path": file_path, "ok": True}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

async def handle_rename_file(request):
    """Rename/move a file or directory on the server filesystem."""
    try:
        body = await request.json()
        old_path = body.get("oldPath", "")
        new_path = body.get("newPath", "")
        if not old_path or not new_path:
            return _error_response("oldPath and newPath are required", status=400, request=request)
        old_path = os.path.realpath(old_path)
        new_path = os.path.realpath(new_path)
        for prefix in BLOCKED_PREFIXES:
            if old_path.startswith(prefix) or new_path.startswith(prefix):
                return _error_response("Access denied: restricted path", status=403, request=request)
        if not os.path.exists(old_path):
            return _error_response("Source path not found", status=404, request=request)
        if os.path.exists(new_path):
            return _error_response("Target path already exists", status=400, request=request)
        try:
            os.rename(old_path, new_path)
        except PermissionError:
            return _error_response("Permission denied", status=403, request=request)
        except OSError as e:
            return _error_response(str(e), status=400, request=request)
        return _json_response({"oldPath": old_path, "newPath": new_path, "ok": True}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

async def handle_mkdir(request):
    """Create a directory on the server filesystem."""
    try:
        body = await request.json()
        dir_path = body.get("path", "")
        if not dir_path:
            return _error_response("path is required", status=400, request=request)
        dir_path = os.path.realpath(dir_path)
        for prefix in BLOCKED_PREFIXES:
            if dir_path.startswith(prefix):
                return _error_response("Access denied: restricted path", status=403, request=request)
        if os.path.exists(dir_path):
            return _error_response("Path already exists", status=400, request=request)
        try:
            os.makedirs(dir_path, exist_ok=True)
        except PermissionError:
            return _error_response("Permission denied", status=403, request=request)
        except OSError as e:
            return _error_response(str(e), status=400, request=request)
        return _json_response({"path": dir_path, "ok": True}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)


# ---------------------------------------------------------------------------
# MCP Tools — Local tool execution endpoints
# ---------------------------------------------------------------------------

# Default allowed commands for shell execution (security allowlist)
MCP_SHELL_TIMEOUT = int(os.environ.get("MCP_SHELL_TIMEOUT", "30"))
MCP_MAX_OUTPUT = int(os.environ.get("MCP_MAX_OUTPUT", "10000"))


async def handle_mcp_list_tools(request):
    """Return the list of available MCP tools."""
    tools = [
        {
            "name": "shell_exec",
            "description": "Execute a shell command and return its output",
            "parameters": {
                "command": {"type": "string", "description": "The shell command to execute"},
                "cwd": {"type": "string", "description": "Working directory (optional)"},
                "timeout": {"type": "number", "description": "Timeout in seconds (default: 30)"},
            },
        },
        {
            "name": "file_read",
            "description": "Read the contents of a file",
            "parameters": {
                "path": {"type": "string", "description": "Absolute or relative file path"},
            },
        },
        {
            "name": "file_write",
            "description": "Write content to a file (creates or overwrites)",
            "parameters": {
                "path": {"type": "string", "description": "File path to write to"},
                "content": {"type": "string", "description": "Content to write"},
            },
        },
        {
            "name": "file_search",
            "description": "Search for files matching a pattern using glob",
            "parameters": {
                "pattern": {"type": "string", "description": "Glob pattern (e.g. '**/*.py')"},
                "cwd": {"type": "string", "description": "Base directory to search from (optional)"},
            },
        },
        {
            "name": "grep_search",
            "description": "Search file contents for a regex pattern",
            "parameters": {
                "pattern": {"type": "string", "description": "Regex pattern to search for"},
                "path": {"type": "string", "description": "Directory or file to search in (optional, default: '.')"},
                "include": {"type": "string", "description": "File glob filter, e.g. '*.py' (optional)"},
            },
        },
        {
            "name": "system_info",
            "description": "Get system information (OS, CPU, memory, disk usage)",
            "parameters": {},
        },
        {
            "name": "process_list",
            "description": "List running processes",
            "parameters": {
                "filter": {"type": "string", "description": "Filter processes by name (optional)"},
            },
        },
        {
            "name": "network_info",
            "description": "Get network interface and connection information",
            "parameters": {},
        },
    ]
    return _json_response({"tools": tools}, request=request)


async def handle_mcp_call_tool(request):
    """Execute an MCP tool and return the result."""
    try:
        body = await request.json()
    except Exception:
        return _error_response("Invalid JSON body", status=400, request=request)

    tool_name = body.get("name", "")
    params = body.get("params", {})

    try:
        if tool_name == "shell_exec":
            result = await _mcp_shell_exec(params)
        elif tool_name == "file_read":
            result = await _mcp_file_read(params)
        elif tool_name == "file_write":
            result = await _mcp_file_write(params)
        elif tool_name == "file_search":
            result = await _mcp_file_search(params)
        elif tool_name == "grep_search":
            result = await _mcp_grep_search(params)
        elif tool_name == "system_info":
            result = await _mcp_system_info()
        elif tool_name == "process_list":
            result = await _mcp_process_list(params)
        elif tool_name == "network_info":
            result = await _mcp_network_info()
        else:
            return _error_response(f"Unknown tool: {tool_name}", status=400, request=request)
        return _json_response({"result": result}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)


async def _mcp_shell_exec(params):
    """Execute a shell command safely."""
    command = params.get("command", "")
    if not command:
        raise ValueError("command is required")
    if len(command) > 2000:
        raise ValueError("command too long (max 2000 chars)")
    cwd = params.get("cwd") or None
    if cwd and not os.path.isdir(cwd):
        raise ValueError(f"cwd does not exist: {cwd}")
    timeout = min(int(params.get("timeout", MCP_SHELL_TIMEOUT)), 120)
    proc = await asyncio.create_subprocess_exec(
        SHELL, "-c", command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=cwd,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return {"exit_code": -1, "stdout": "", "stderr": "Command timed out"}
    stdout_str = stdout.decode(errors="replace")[:MCP_MAX_OUTPUT]
    stderr_str = stderr.decode(errors="replace")[:MCP_MAX_OUTPUT]
    return {"exit_code": proc.returncode, "stdout": stdout_str, "stderr": stderr_str}


async def _mcp_file_read(params):
    """Read a file and return its content."""
    path = params.get("path", "")
    if not path:
        raise ValueError("path is required")
    path = os.path.expanduser(path)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"File not found: {path}")
    size = os.path.getsize(path)
    if size > 1024 * 1024:  # 1MB limit
        raise ValueError(f"File too large: {size} bytes (limit: 1MB)")
    with open(path, "r", errors="replace") as f:
        content = f.read()
    return {"path": path, "content": content, "size": size}


async def _mcp_file_write(params):
    """Write content to a file."""
    path = params.get("path", "")
    content = params.get("content", "")
    if not path:
        raise ValueError("path is required")
    path = os.path.expanduser(path)
    parent = os.path.dirname(path)
    if parent and not os.path.exists(parent):
        os.makedirs(parent, exist_ok=True)
    with open(path, "w") as f:
        f.write(content)
    return {"path": path, "size": len(content), "ok": True}


async def _mcp_file_search(params):
    """Search for files using glob patterns."""
    import glob as glob_mod
    pattern = params.get("pattern", "")
    if not pattern:
        raise ValueError("pattern is required")
    cwd = params.get("cwd") or "."
    cwd = os.path.expanduser(cwd)
    full_pattern = os.path.join(cwd, pattern)
    matches = glob_mod.glob(full_pattern, recursive=True)
    return {"pattern": pattern, "cwd": cwd, "matches": matches[:200]}


async def _mcp_grep_search(params):
    """Search file contents for a regex pattern using grep."""
    pattern = params.get("pattern", "")
    if not pattern:
        raise ValueError("pattern is required")
    if len(pattern) > 500:
        raise ValueError("pattern too long (max 500 chars)")
    path = params.get("path") or "."
    path = os.path.expanduser(path)
    include = params.get("include", "")
    cmd_parts = ["grep", "-rn", "--color=never"]
    if include:
        cmd_parts.extend(["--include", include])
    cmd_parts.extend(["--", pattern, path])
    proc = await asyncio.create_subprocess_exec(
        *cmd_parts,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
    except asyncio.TimeoutError:
        proc.kill()
        return {"matches": [], "error": "Search timed out"}
    lines = stdout.decode(errors="replace").strip().splitlines()[:100]
    return {"pattern": pattern, "path": path, "matches": lines}


async def _mcp_system_info():
    """Get basic system information."""
    import platform
    info = {
        "os": platform.system(),
        "os_version": platform.version(),
        "architecture": platform.machine(),
        "hostname": platform.node(),
        "python_version": platform.python_version(),
    }
    # Disk usage
    try:
        usage = shutil.disk_usage("/")
        info["disk"] = {
            "total_gb": round(usage.total / (1024**3), 2),
            "used_gb": round(usage.used / (1024**3), 2),
            "free_gb": round(usage.free / (1024**3), 2),
        }
    except Exception:
        pass
    # Memory info (Linux)
    try:
        with open("/proc/meminfo") as f:
            mem = {}
            for line in f:
                parts = line.split(":")
                if len(parts) == 2:
                    key = parts[0].strip()
                    val = parts[1].strip().split()[0]
                    if key in ("MemTotal", "MemAvailable", "MemFree"):
                        mem[key] = int(val) // 1024  # MB
            info["memory_mb"] = mem
    except Exception:
        pass
    return info


async def _mcp_process_list(params):
    """List running processes, optionally filtered."""
    filter_str = params.get("filter", "")
    proc = await asyncio.create_subprocess_exec(
        "ps", "aux",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    lines = stdout.decode(errors="replace").strip().splitlines()
    if filter_str:
        header = lines[0] if lines else ""
        filtered = [l for l in lines[1:] if filter_str.lower() in l.lower()]
        lines = ([header] + filtered) if header else filtered
    return {"processes": lines[:50]}


async def _mcp_network_info():
    """Get network interface information."""
    result = {}
    # Try ip addr
    try:
        proc = await asyncio.create_subprocess_exec(
            "ip", "addr",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        if proc.returncode == 0:
            result["interfaces"] = stdout.decode(errors="replace").strip()
    except Exception:
        pass
    # Active connections
    try:
        proc = await asyncio.create_subprocess_exec(
            "ss", "-tuln",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        if proc.returncode == 0:
            result["listening_ports"] = stdout.decode(errors="replace").strip()
    except Exception:
        pass
    return result


# ---------------------------------------------------------------------------
# News Proxy — fetch RSS feeds for the Real World Predictor
# ---------------------------------------------------------------------------

NEWS_RSS_SOURCES = [
    ("新华网", "http://www.xinhuanet.com/rss/world.xml"),
    ("人民网国际", "http://www.people.com.cn/rss/world.xml"),
    ("央视新闻国际", "http://news.cctv.com/world/rss.xml"),
    ("中国日报国际", "https://www.chinadaily.com.cn/rss/world_rss.xml"),
    ("中新网国际", "http://www.chinanews.com/rss/world.xml"),
    ("观察者网国际", "https://www.guancha.cn/rss/world.xml"), 
    ("NPR News", "https://feeds.npr.org/1001/rss.xml"),
    ("CNBC World", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362"),
    
    # ("BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml"),
    # ("Reuters World", "https://www.reutersagency.com/feed/?taxonomy=best-sectors&post_type=best"),
    # ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml"),
    # ("NY Times World", "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"),
    # ("The Guardian", "https://www.theguardian.com/world/rss"),
    # ("Google News World", "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXigAQE?hl=en-US&gl=US&ceid=US:en"),
    # ("Google News CN", "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0JYcG9MVU5PR2dKRFRpZ0FQAQ?hl=zh-CN&gl=CN&ceid=CN:zh-Hans"),
    # ("澎湃国际", "https://www.thepaper.cn/rss.jsp?nodeid=25950"), 
    # ("环球网国际", "http://rss.huanqiu.com/world.xml"),
]


async def handle_news_fetch(request):
    """Proxy RSS feeds to avoid CORS issues in the browser.

    Fetches from multiple mainstream news sources in parallel for speed.
    Strips HTML from descriptions and returns up to *count* items per source.

    Query parameters:
      - count: max items per source (default 10, capped at 50)
      - sources: comma-separated source names to include (default: all)
    """
    import aiohttp
    import xml.etree.ElementTree as ET
    import asyncio
    import re

    # Parse optional query parameters
    try:
        per_source_count = int(request.query.get("count", "10"))
    except ValueError:
        per_source_count = 10
    per_source_count = max(1, min(per_source_count, 50))

    sources_param = request.query.get("sources", "")
    if sources_param:
        allowed_sources = set(s.strip() for s in sources_param.split(",") if s.strip())
    else:
        allowed_sources = None  # means all

    # Filter news sources
    active_sources = [
        (name, url) for name, url in NEWS_RSS_SOURCES
        if allowed_sources is None or name in allowed_sources
    ]

    def _clean_html(text):
        """Remove HTML tags from RSS description text."""
        result = text
        prev = None
        while result != prev:
            prev = result
            result = re.sub(r'<[^>]*>', '', result)
        return result.strip()

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
    }

    async def fetch_one(session, source_name, url):
        items = []
        try:
            async with session.get(url, headers=headers,
                                   timeout=aiohttp.ClientTimeout(total=12),
                                   allow_redirects=True) as resp:
                if resp.status != 200:
                    return items
                text = await resp.text()
                # Validate that response looks like XML before parsing
                stripped = text.lstrip()
                if not stripped or (not stripped.startswith('<?xml') and
                                   not stripped.startswith('<rss') and
                                   not stripped.startswith('<feed') and
                                   not stripped.startswith('<channel')):
                    log.warning("Non-XML response from %s (starts with: %s)",
                                source_name, stripped[:60].replace('\n', ' '))
                    return items
                root = ET.fromstring(text)
                # RSS items are typically at channel/item; also check for Atom entries
                found = list(root.iter("item"))
                if not found:
                    # Atom feed: entries
                    ns = {'atom': 'http://www.w3.org/2005/Atom'}
                    found = list(root.iter("{http://www.w3.org/2005/Atom}entry"))
                for idx, item in enumerate(found):
                    if idx >= per_source_count:
                        break
                    title_el = item.find("title")
                    if title_el is None:
                        title_el = item.find("{http://www.w3.org/2005/Atom}title")
                    desc_el = item.find("description")
                    if desc_el is None:
                        desc_el = item.find("{http://www.w3.org/2005/Atom}summary")
                    pub_el = item.find("pubDate")
                    if pub_el is None:
                        pub_el = item.find("{http://www.w3.org/2005/Atom}updated")
                    title = title_el.text if title_el is not None and title_el.text else ""
                    description = desc_el.text if desc_el is not None and desc_el.text else ""
                    pub_date = pub_el.text if pub_el is not None and pub_el.text else ""
                    if title:
                        items.append({
                            "title": _clean_html(title.strip()),
                            "description": _clean_html(description.strip())[:300],
                            "source": source_name,
                            "date": pub_date,
                        })
        except Exception as e:
            log.warning("Failed to fetch RSS from %s: %s", source_name, e)
        return items

    headlines = []
    async with aiohttp.ClientSession() as session:
        tasks = [fetch_one(session, name, url) for name, url in active_sources]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for result in results:
            if isinstance(result, list):
                headlines.extend(result)

    return _json_response({"headlines": headlines}, request=request)


# ---------------------------------------------------------------------------
# Web Search Proxy — search engine integration for Real World Predictor
# ---------------------------------------------------------------------------

def _strip_html_tags(text):
    """Remove HTML tags from a string, handling nested/incomplete tags."""
    import re
    result = text
    prev = None
    while result != prev:
        prev = result
        result = re.sub(r'<[^>]*>', '', result)
    return result.strip()


async def handle_search_query(request):
    """Proxy search requests to search engines to avoid CORS issues."""
    import aiohttp
    import re
    import urllib.parse

    query = request.query.get('q', '').strip()
    if not query:
        return _error_response("Missing query parameter 'q'", status=400, request=request)

    results = []
    engine = "Unknown"

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    }

    async with aiohttp.ClientSession() as session:
        # --- Primary: Bing web search ---
        try:
            bing_url = f'https://www.bing.com/search?q={urllib.parse.quote(query)}&setlang=en'
            async with session.get(
                bing_url, headers=headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status == 200:
                    html_text = await resp.text()
                    # Parse Bing search results
                    # Match result blocks: <li class="b_algo">...<h2><a href="URL">TITLE</a></h2>...<p>SNIPPET</p>...</li>
                    blocks = re.findall(
                        r'<li\s+class="b_algo"[^>]*>(.*?)</li>',
                        html_text, re.DOTALL,
                    )
                    for block in blocks[:10]:
                        # Extract URL and title from <h2><a href="...">title</a></h2>
                        link_match = re.search(r'<a\s+href="([^"]+)"[^>]*>(.*?)</a>', block, re.DOTALL)
                        if not link_match:
                            continue
                        url = link_match.group(1)
                        raw_title = link_match.group(2)
                        title = _strip_html_tags(raw_title).strip()
                        # Extract snippet from <p> or caption div
                        snippet_match = re.search(r'<p[^>]*>(.*?)</p>', block, re.DOTALL)
                        if not snippet_match:
                            snippet_match = re.search(r'<div\s+class="b_caption"[^>]*>.*?<p>(.*?)</p>', block, re.DOTALL)
                        snippet = _strip_html_tags(snippet_match.group(1)).strip() if snippet_match else ''
                        if title:
                            results.append({
                                'title': title,
                                'snippet': snippet[:300],
                                'url': url,
                            })
                    if results:
                        engine = "Bing"
        except Exception as e:
            log.warning("Bing search failed: %s", e)

        # --- Fallback 1: DuckDuckGo HTML search ---
        if not results:
            try:
                search_url = 'https://html.duckduckgo.com/html/'
                form_data = {'q': query}
                async with session.post(
                    search_url, data=form_data, headers=headers,
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as resp:
                    if resp.status == 200:
                        html_text = await resp.text()
                        title_matches = re.findall(
                            r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>',
                            html_text, re.DOTALL,
                        )
                        snippet_matches = re.findall(
                            r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>',
                            html_text, re.DOTALL,
                        )

                        for i, (url, raw_title) in enumerate(title_matches[:10]):
                            title = _strip_html_tags(raw_title)
                            snippet = _strip_html_tags(snippet_matches[i]) if i < len(snippet_matches) else ''
                            if 'uddg=' in url:
                                actual = re.search(r'uddg=([^&]+)', url)
                                if actual:
                                    url = urllib.parse.unquote(actual.group(1))
                            if title:
                                results.append({
                                    'title': title,
                                    'snippet': snippet[:300],
                                    'url': url,
                                })
                        if results:
                            engine = "DuckDuckGo"
            except Exception as e:
                log.warning("DuckDuckGo HTML search failed: %s", e)

        # --- Fallback 2: DuckDuckGo instant answer API ---
        if not results:
            try:
                api_url = f'https://api.duckduckgo.com/?q={urllib.parse.quote(query)}&format=json&no_html=1'
                async with session.get(
                    api_url, headers=headers,
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json(content_type=None)
                        if data.get('AbstractText'):
                            results.append({
                                'title': data.get('Heading', query),
                                'snippet': data['AbstractText'][:300],
                                'url': data.get('AbstractURL', ''),
                            })
                        for topic in (data.get('RelatedTopics') or [])[:8]:
                            if isinstance(topic, dict) and topic.get('Text'):
                                results.append({
                                    'title': topic['Text'][:100],
                                    'snippet': topic['Text'][:300],
                                    'url': topic.get('FirstURL', ''),
                                })
                        if results:
                            engine = "DuckDuckGo API"
            except Exception as e:
                log.warning("DuckDuckGo API fallback failed: %s", e)

    # --- Fallback 3: duckduckgo-search Python library ---
    if not results:
        try:
            from duckduckgo_search import DDGS
            ddgs = DDGS()
            ddg_results = ddgs.text(query, max_results=10)
            for r in ddg_results:
                title = r.get('title', '')
                snippet = r.get('body', '')
                url = r.get('href', '')
                if title:
                    results.append({
                        'title': title,
                        'snippet': snippet[:300],
                        'url': url,
                    })
            if results:
                engine = "DuckDuckGo (Library)"
        except Exception as e:
            log.warning("duckduckgo-search library fallback failed: %s", e)

    return _json_response({
        "engine": engine,
        "query": query,
        "results": results,
    }, request=request)


# ---------------------------------------------------------------------------
# Auto-Label — save / list / update / delete labeled images (YOLO format)
# ---------------------------------------------------------------------------
_label_dir = os.path.join(os.path.expanduser("~"), "auto_labels")
_label_dir_lock = asyncio.Lock()

def _get_label_dir():
    return _label_dir

def _get_image_dir():
    return os.path.join(_get_label_dir(), "images")

def _get_label_subdir():
    return os.path.join(_get_label_dir(), "labels")

def _ensure_label_dir():
    os.makedirs(_get_label_dir(), exist_ok=True)
    os.makedirs(_get_image_dir(), exist_ok=True)
    os.makedirs(_get_label_subdir(), exist_ok=True)

def _validate_label_filename(fname):
    """Validate filename to prevent path traversal. Returns True if safe."""
    if not fname:
        return False
    # Normalize and check the resolved path stays within image_dir
    image_dir = os.path.realpath(_get_image_dir())
    resolved = os.path.realpath(os.path.join(image_dir, fname))
    return resolved.startswith(image_dir + os.sep) or resolved == image_dir

def _get_classes_path():
    return os.path.join(_get_label_dir(), "classes.txt")

def _load_classes():
    """Load class name list from classes.txt."""
    cp = _get_classes_path()
    if os.path.exists(cp):
        with open(cp) as f:
            return [line.strip() for line in f if line.strip()]
    return []

def _save_classes(classes):
    """Save class name list to classes.txt."""
    cp = _get_classes_path()
    with open(cp, "w") as f:
        for c in classes:
            f.write(c + "\n")

def _get_class_id(label, classes):
    """Get or create class id for a label. Returns (id, updated_classes)."""
    for i, c in enumerate(classes):
        if c == label:
            return i, classes
    classes = list(classes) + [label]
    return len(classes) - 1, classes

def _annotations_to_yolo(annotations, classes):
    """Convert annotations (0-1000 range) to YOLO format lines.
    YOLO format: class_id center_x center_y width height (all 0-1 normalized).
    Returns (lines, updated_classes)."""
    lines = []
    updated = list(classes)
    for ann in annotations:
        bbox = ann.get("bbox", [0, 0, 0, 0])
        if not isinstance(bbox, list) or len(bbox) < 4:
            bbox = [0, 0, 0, 0]
        x1 = ann.get("x1") if ann.get("x1") is not None else bbox[0]
        y1 = ann.get("y1") if ann.get("y1") is not None else bbox[1]
        x2 = ann.get("x2") if ann.get("x2") is not None else bbox[2]
        y2 = ann.get("y2") if ann.get("y2") is not None else bbox[3]
        label = ann.get("label", "unknown")
        cid, updated = _get_class_id(label, updated)
        # Convert from 0-1000 to 0-1
        cx = ((x1 + x2) / 2.0) / 1000.0
        cy = ((y1 + y2) / 2.0) / 1000.0
        w = abs(x2 - x1) / 1000.0
        h = abs(y2 - y1) / 1000.0
        lines.append(f"{cid} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
    return lines, updated

def _yolo_to_annotations(yolo_lines, classes):
    """Convert YOLO format lines back to annotation objects (0-1000 range)."""
    annotations = []
    for line in yolo_lines:
        parts = line.strip().split()
        if len(parts) < 5:
            continue
        try:
            cid = int(parts[0])
            cx, cy, w, h = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
        except (ValueError, IndexError):
            continue
        label = classes[cid] if cid < len(classes) else f"class_{cid}"
        x1 = (cx - w / 2.0) * 1000.0
        y1 = (cy - h / 2.0) * 1000.0
        x2 = (cx + w / 2.0) * 1000.0
        y2 = (cy + h / 2.0) * 1000.0
        annotations.append({
            "bbox": [x1, y1, x2, y2],
            "label": label,
            "x1": x1, "y1": y1, "x2": x2, "y2": y2,
        })
    return annotations

async def handle_label_save(request):
    """Save a labeled image with YOLO-format annotations.
    Images go to <dir>/images/, labels to <dir>/labels/, classes.txt in <dir>/."""
    try:
        body = await request.json()
        image_b64 = body.get("image", "")
        annotations = body.get("annotations", [])
        filename = body.get("filename", "")
        overwrite = body.get("overwrite", False)

        if not image_b64:
            return _error_response("No image data", status=400, request=request)

        _ensure_label_dir()
        image_dir = _get_image_dir()
        label_subdir = _get_label_subdir()

        # Decode the base64 image
        img_data = base64.b64decode(image_b64)

        # Compress large images to JPEG to avoid "Request Entity Too Large"
        if len(img_data) > 500_000:
            try:
                from io import BytesIO
                from PIL import Image as PILImage
                buf = BytesIO(img_data)
                img = PILImage.open(buf)
                out = BytesIO()
                img = img.convert("RGB")
                img.save(out, format="JPEG", quality=85, optimize=True)
                img_data = out.getvalue()
                ext = ".jpg"
            except ImportError:
                ext = ".png"
        else:
            ext = ".png"

        if not filename:
            import time as _time
            filename = f"label_{int(_time.time() * 1000)}{ext}"

        img_path = os.path.join(image_dir, filename)

        # If file already exists and overwrite not requested, generate unique name
        if os.path.exists(img_path) and not overwrite:
            import time as _time2
            stem_orig = os.path.splitext(filename)[0]
            ext_orig = os.path.splitext(filename)[1]
            filename = f"{stem_orig}_{int(_time2.time() * 1000)}{ext_orig}"
            img_path = os.path.join(image_dir, filename)

        with open(img_path, "wb") as f:
            f.write(img_data)

        # Save YOLO-format annotation .txt file in labels/ subdirectory
        stem = os.path.splitext(filename)[0]
        async with _label_dir_lock:
            classes = _load_classes()
            yolo_lines, classes = _annotations_to_yolo(annotations, classes)
            _save_classes(classes)

        txt_path = os.path.join(label_subdir, stem + ".txt")
        with open(txt_path, "w") as f:
            f.write("\n".join(yolo_lines) + ("\n" if yolo_lines else ""))

        return _json_response({"ok": True, "filename": filename, "size": len(img_data)}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

async def handle_label_list(request):
    """List all saved labeled images with their YOLO annotations.
    Images are in <dir>/images/, labels in <dir>/labels/."""
    try:
        _ensure_label_dir()
        image_dir = _get_image_dir()
        label_subdir = _get_label_subdir()
        classes = _load_classes()
        items = []
        for fname in sorted(os.listdir(image_dir)):
            if fname.endswith((".txt", ".json")):
                continue
            stem = os.path.splitext(fname)[0]
            txt_path = os.path.join(label_subdir, stem + ".txt")
            annotations = []
            if os.path.exists(txt_path):
                with open(txt_path) as f:
                    yolo_lines = [l for l in f.read().strip().splitlines() if l.strip()]
                annotations = _yolo_to_annotations(yolo_lines, classes)
            fpath = os.path.join(image_dir, fname)
            size = os.path.getsize(fpath)
            items.append({
                "filename": fname,
                "size": size,
                "annotations": annotations,
            })
        return _json_response({"items": items, "dir": _get_label_dir(), "classes": classes}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

async def handle_label_image(request):
    """Serve a saved labeled image file from <dir>/images/."""
    try:
        fname = request.query.get("filename", "")
        if not _validate_label_filename(fname):
            return _error_response("Invalid filename", status=400, request=request)
        image_dir = _get_image_dir()
        fpath = os.path.join(image_dir, fname)
        if not os.path.exists(fpath):
            return _error_response("Not found", status=404, request=request)
        # Return base64 encoded image
        with open(fpath, "rb") as f:
            data = f.read()
        b64 = base64.b64encode(data).decode("ascii")
        ct = "image/jpeg" if fname.lower().endswith((".jpg", ".jpeg")) else "image/png"
        return _json_response({"image": b64, "content_type": ct, "filename": fname}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

async def handle_label_update(request):
    """Update YOLO annotations for a labeled image. Label in <dir>/labels/."""
    try:
        body = await request.json()
        fname = body.get("filename", "")
        annotations = body.get("annotations", [])
        if not _validate_label_filename(fname):
            return _error_response("Invalid filename", status=400, request=request)
        image_dir = _get_image_dir()
        if not os.path.exists(os.path.join(image_dir, fname)):
            return _error_response("Image not found", status=404, request=request)
        stem = os.path.splitext(fname)[0]
        async with _label_dir_lock:
            classes = _load_classes()
            yolo_lines, classes = _annotations_to_yolo(annotations, classes)
            _save_classes(classes)
        txt_path = os.path.join(_get_label_subdir(), stem + ".txt")
        with open(txt_path, "w") as f:
            f.write("\n".join(yolo_lines) + ("\n" if yolo_lines else ""))
        return _json_response({"ok": True}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

async def handle_label_delete(request):
    """Delete a labeled image from <dir>/images/ and its YOLO annotations from <dir>/labels/.
    Supports single delete (filename) or batch delete (filenames array)."""
    try:
        body = await request.json()
        filenames = body.get("filenames", [])
        single = body.get("filename", "")
        if single and not filenames:
            filenames = [single]
        if not filenames:
            return _error_response("No filenames provided", status=400, request=request)
        image_dir = _get_image_dir()
        label_subdir = _get_label_subdir()
        deleted = []
        errors = []
        for fname in filenames:
            if not _validate_label_filename(fname):
                errors.append(f"Invalid filename: {fname}")
                continue
            fpath = os.path.join(image_dir, fname)
            stem = os.path.splitext(fname)[0]
            txt_path = os.path.join(label_subdir, stem + ".txt")
            try:
                if os.path.exists(fpath):
                    os.remove(fpath)
                if os.path.exists(txt_path):
                    os.remove(txt_path)
                deleted.append(fname)
            except Exception as e:
                errors.append(f"Failed to delete {fname}: {str(e)}")
        return _json_response({"ok": True, "deleted": deleted, "errors": errors}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

async def handle_label_set_path(request):
    """Set the label save directory."""
    global _label_dir
    try:
        body = await request.json()
        path = body.get("path", "").strip()
        if not path:
            return _error_response("Path is required", status=400, request=request)
        # Expand user home dir and resolve
        path = os.path.realpath(os.path.expanduser(path))
        # Create if not exists
        os.makedirs(path, exist_ok=True)
        async with _label_dir_lock:
            _label_dir = path
        return _json_response({"ok": True, "path": _label_dir}, request=request)
    except Exception as exc:
        return _error_response(str(exc), request=request)

async def handle_label_get_path(request):
    """Get the current label save directory."""
    return _json_response({"path": _get_label_dir()}, request=request)


def create_adb_app():
    app = web.Application(client_max_size=50 * 1024 * 1024)  # 50MB max body
    # CORS preflight
    app.router.add_route("OPTIONS", "/{path:.*}", handle_options)
    # File system endpoints
    app.router.add_get("/api/fs/list", handle_list_dir)
    app.router.add_get("/api/fs/read", handle_read_file)
    app.router.add_post("/api/fs/write", handle_write_file)
    app.router.add_post("/api/fs/create", handle_create_file)
    app.router.add_post("/api/fs/delete", handle_delete_file)
    app.router.add_post("/api/fs/rename", handle_rename_file)
    app.router.add_post("/api/fs/mkdir", handle_mkdir)
    # MCP tool endpoints
    app.router.add_get("/api/mcp/tools", handle_mcp_list_tools)
    app.router.add_post("/api/mcp/call", handle_mcp_call_tool)
    # ADB endpoints
    app.router.add_get("/api/adb/devices", handle_devices)
    app.router.add_get("/api/adb/screenshot", handle_screenshot)
    app.router.add_post("/api/adb/click", handle_click)
    app.router.add_post("/api/adb/swipe", handle_swipe)
    app.router.add_post("/api/adb/keyevent", handle_keyevent)
    app.router.add_post("/api/adb/input/text", handle_input_text)
    app.router.add_post("/api/adb/keyboard/input", handle_keyboard_input)
    app.router.add_get("/api/adb/screen-size", handle_screen_size)
    # Scrcpy streaming & recording
    app.router.add_get("/ws/scrcpy/stream", handle_scrcpy_stream)
    app.router.add_post("/api/scrcpy/record/start", handle_scrcpy_record_start)
    app.router.add_post("/api/scrcpy/record/stop", handle_scrcpy_record_stop)
    # News proxy endpoint
    app.router.add_get("/api/news/fetch", handle_news_fetch)
    # Search engine proxy endpoint
    app.router.add_get("/api/search/query", handle_search_query)
    # Auto-label endpoints
    app.router.add_post("/api/label/save", handle_label_save)
    app.router.add_get("/api/label/list", handle_label_list)
    app.router.add_get("/api/label/image", handle_label_image)
    app.router.add_post("/api/label/update", handle_label_update)
    app.router.add_post("/api/label/delete", handle_label_delete)
    app.router.add_post("/api/label/set-path", handle_label_set_path)
    app.router.add_get("/api/label/get-path", handle_label_get_path)
    return app

# ---------------------------------------------------------------------------
# Terminal — WebSocket handler
# ---------------------------------------------------------------------------
async def terminal_handler(ws):
    """Handle a single terminal WebSocket connection."""
    master_fd, slave_fd = pty.openpty()

    pid = os.fork()
    if pid == 0:
        # ---- child process ----
        os.close(master_fd)
        os.setsid()
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        os.execvp(SHELL, [SHELL])
        # never reached

    # ---- parent process ----
    os.close(slave_fd)
    log.info("Terminal session started (pid=%d, shell=%s)", pid, SHELL)

    loop = asyncio.get_event_loop()
    last_cwd = [None]

    def _get_child_cwd():
        """Read the current working directory of the child shell process."""
        try:
            return os.readlink(f"/proc/{pid}/cwd")
        except (OSError, FileNotFoundError):
            return None

    async def cwd_watcher():
        """Periodically check child process CWD and notify the client."""
        try:
            while True:
                await asyncio.sleep(1)
                cwd = await loop.run_in_executor(None, _get_child_cwd)
                if cwd and cwd != last_cwd[0]:
                    last_cwd[0] = cwd
                    try:
                        await ws.send(json.dumps({"type": "cwd", "data": cwd}))
                    except websockets.exceptions.ConnectionClosed:
                        break
        except asyncio.CancelledError:
            pass

    async def pty_reader():
        """Read from PTY master fd and send to WebSocket."""
        try:
            while True:
                data = await loop.run_in_executor(None, os.read, master_fd, 4096)
                if not data:
                    break
                await ws.send(json.dumps({"type": "output", "data": data.decode("utf-8", errors="replace")}))
        except (OSError, websockets.exceptions.ConnectionClosed):
            pass

    async def ws_reader():
        """Read from WebSocket and write to PTY master fd."""
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    continue
                if msg.get("type") == "input":
                    data = msg.get("data", "")
                    os.write(master_fd, data.encode("utf-8"))
                elif msg.get("type") == "resize":
                    cols = int(msg.get("cols", 80))
                    rows = int(msg.get("rows", 24))
                    winsize = struct.pack("HHHH", rows, cols, 0, 0)
                    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
        except (OSError, websockets.exceptions.ConnectionClosed):
            pass

    cwd_task = asyncio.create_task(cwd_watcher())
    try:
        await asyncio.gather(pty_reader(), ws_reader())
    finally:
        cwd_task.cancel()
        os.close(master_fd)
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            pass
        log.info("Terminal session ended (pid=%d)", pid)

# ---------------------------------------------------------------------------
# Agent Terminal — WebSocket handler
# ---------------------------------------------------------------------------
# Path to the agent-terminal project relative to this server.py
_CLAUDE_CODE_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "agent-terminal")
)
CLAUDE_CODE_CMD = os.environ.get("CLAUDE_CODE_CMD", "")


def _resolve_claude_code_cmd():
    """Return the command list used to launch Agent Terminal inside a PTY.

    Priority:
      1. CLAUDE_CODE_CMD env var  (user override, e.g. "bun run dev")
      2. Built dist/cli.js        (if bun is available + dist exists)
      3. bun run dev              (development mode)
      4. Fallback message printed to the PTY
    """
    if CLAUDE_CODE_CMD:
        return CLAUDE_CODE_CMD.split()

    bun = shutil.which("bun")
    dist_cli = os.path.join(_CLAUDE_CODE_DIR, "dist", "cli.js")

    if bun and os.path.isfile(dist_cli):
        return [bun, "run", dist_cli]

    if bun:
        return [bun, "run", "dev"]

    # No bun — return None so the handler can print an error
    return None


async def claude_code_handler(ws):
    """Handle a single Agent Terminal WebSocket connection."""
    cmd = _resolve_claude_code_cmd()
    if cmd is None:
        # Notify the client that bun is not available
        await ws.send(json.dumps({
            "type": "output",
            "data": "\x1b[1;31m✗ Cannot start Agent Terminal: 'bun' not found in PATH.\x1b[0m\r\n"
                    "\x1b[90mPlease install Bun (https://bun.sh) and rebuild agent-terminal:\x1b[0m\r\n"
                    "\x1b[93m  cd agent-terminal && bun install && bun run build\x1b[0m\r\n"
        }))
        return

    master_fd, slave_fd = pty.openpty()

    pid = os.fork()
    if pid == 0:
        # ---- child process ----
        os.close(master_fd)
        os.setsid()
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        os.chdir(_CLAUDE_CODE_DIR)
        os.execvp(cmd[0], cmd)
        # never reached

    # ---- parent process ----
    os.close(slave_fd)
    log.info("Agent Terminal session started (pid=%d, cmd=%s)", pid, " ".join(cmd))

    loop = asyncio.get_event_loop()

    async def pty_reader():
        """Read from PTY master fd and send to WebSocket."""
        try:
            while True:
                data = await loop.run_in_executor(None, os.read, master_fd, 4096)
                if not data:
                    break
                await ws.send(json.dumps({"type": "output", "data": data.decode("utf-8", errors="replace")}))
        except (OSError, websockets.exceptions.ConnectionClosed):
            pass

    async def ws_reader():
        """Read from WebSocket and write to PTY master fd."""
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    continue
                if msg.get("type") == "input":
                    data = msg.get("data", "")
                    os.write(master_fd, data.encode("utf-8"))
                elif msg.get("type") == "resize":
                    cols = int(msg.get("cols", 80))
                    rows = int(msg.get("rows", 24))
                    winsize = struct.pack("HHHH", rows, cols, 0, 0)
                    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
        except (OSError, websockets.exceptions.ConnectionClosed):
            pass

    try:
        await asyncio.gather(pty_reader(), ws_reader())
    finally:
        os.close(master_fd)
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            pass
        log.info("Agent Terminal session ended (pid=%d)", pid)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
async def main():
    # Start ADB bridge HTTP server
    adb_app = create_adb_app()
    adb_runner = web.AppRunner(adb_app)
    await adb_runner.setup()
    adb_site = web.TCPSite(adb_runner, BIND_HOST, ADB_PORT)
    await adb_site.start()
    log.info("ADB bridge HTTP server running on http://%s:%d", BIND_HOST, ADB_PORT)

    # Start terminal WebSocket server
    ws_server = await websockets.serve(terminal_handler, BIND_HOST, TERMINAL_PORT)
    log.info("Terminal WebSocket server running on ws://%s:%d", BIND_HOST, TERMINAL_PORT)

    # Start Agent Terminal WebSocket server
    claude_ws_server = await websockets.serve(claude_code_handler, BIND_HOST, CLAUDE_CODE_PORT)
    log.info("Agent Terminal WebSocket server running on ws://%s:%d", BIND_HOST, CLAUDE_CODE_PORT)

    log.info("All servers are ready. Press Ctrl+C to stop.")

    # Keep running until interrupted
    stop = asyncio.Event()
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    await stop.wait()

    log.info("Shutting down...")
    ws_server.close()
    claude_ws_server.close()
    await ws_server.wait_closed()
    await claude_ws_server.wait_closed()
    await adb_runner.cleanup()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
