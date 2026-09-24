"""Start TRAP.bat while another copy is already open: the new window must
either hand you the running page or close the older copy and take over."""
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def start(port, tmp_path, *extra):
    env = dict(os.environ, TRAP_DATA_DIR=str(tmp_path))
    return subprocess.Popen([sys.executable, "-m", "server", "--demo", "--no-browser", "--port", str(port), *extra],
                            cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def wait_up(port, secs=30):
    end = time.time() + secs
    while time.time() < end:
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.2)
    return False


def test_second_start_hands_over_or_replaces(tmp_path, monkeypatch):
    from server import config, launcher
    port = free_port()
    first = start(port, tmp_path)
    try:
        assert wait_up(port)
        found = launcher.who_is_on(port)
        assert found["kind"] == "same" and found["pid"] == first.pid

        # Same copy again: says so and exits without a second server.
        second = start(port, tmp_path)
        out, _ = second.communicate(timeout=30)
        assert second.returncode == 0 and "already running" in out
        assert first.poll() is None

        # A different (older) copy: this one closes it.
        monkeypatch.setattr(config, "APP_VERSION", "0.9.0")
        found = launcher.who_is_on(port)
        assert found["kind"] == "old_trap"
        assert launcher.stop_old_copy(found, port)
        first.wait(timeout=10)
        assert launcher.who_is_on(port)["kind"] == "free"
    finally:
        if first.poll() is None:
            first.kill()


def test_someone_else_on_the_port(tmp_path):
    from server import launcher
    port = free_port()
    other = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
                             cwd=tmp_path, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        assert wait_up(port)
        assert launcher.who_is_on(port)["kind"] == "other"
        alt = launcher.free_port_near(port)
        assert alt and alt != port
        assert not launcher.stop_old_copy({"kind": "other", "pid": None}, port) or sys.platform == "win32"
    finally:
        other.kill()


def test_hello_hides_details_from_the_tailnet_name(tmp_path, monkeypatch):
    port = free_port()
    p = start(port, tmp_path)
    try:
        assert wait_up(port)
        import http.client
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        c.request("GET", "/hello", headers={"Host": "evil.example"})
        assert c.getresponse().status == 403          # the host check still applies
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        c.request("GET", "/hello")
        body = c.getresponse().read().decode()
        assert "TRAP Discipline" in body and "pid" in body
    finally:
        p.kill()


def test_shortcut_file(tmp_path):
    from server import launcher
    launcher.write_shortcut("http://127.0.0.1:8080/", tmp_path)
    assert "URL=http://127.0.0.1:8080/" in (tmp_path / "Open TRAP.url").read_text()


def test_windows_netstat_parsing(monkeypatch):
    """The copy you're running now has no /hello, so on Windows the new copy
    finds its process from netstat."""
    from server import launcher

    class R:
        stdout = ("\r\nActive Connections\r\n\r\n  Proto  Local Address          Foreign Address        State           PID\r\n"
                  "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1000\r\n"
                  "  TCP    127.0.0.1:18080        0.0.0.0:0              LISTENING       2222\r\n"
                  "  TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING       4321\r\n"
                  "  TCP    127.0.0.1:8080         127.0.0.1:50000        ESTABLISHED     4321\r\n")
    monkeypatch.setattr(launcher.subprocess, "run", lambda *a, **k: R())
    assert launcher._windows_listener_pid(8080) == 4321
