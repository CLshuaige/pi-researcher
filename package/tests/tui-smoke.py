"""Exercise the installed Pi CLI in a real PTY, with an isolated offline provider."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import struct
import subprocess
import tempfile
import termios
import time

repo = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="research-tui-") as tmp:
    root = Path(tmp) / "workspace"
    agent = Path(tmp) / "agent"
    root.mkdir()
    agent.mkdir()
    (agent / "settings.json").write_text(json.dumps({"quietStartup": True, "hideThinkingBlock": True}))
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 140, 0, 0))
    env = dict(os.environ, PI_CODING_AGENT_DIR=str(agent), PI_OFFLINE="1", PI_TELEMETRY="0", TERM="xterm-256color")
    proc = subprocess.Popen([
        "node", str(repo / "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"),
        "--offline", "--no-extensions", "--no-mcp", "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-themes",
        "-e", str(repo / "extensions/researcher/index.ts"), "-e", str(repo / "tests/fixtures/tui-provider.ts"),
        "--model", "research-smoke/local", "--thinking", "off", "--tui-mode", "regular", "--no-session",
    ], cwd=root, env=env, stdin=slave, stdout=slave, stderr=slave)
    os.close(slave)
    output = bytearray()

    def drain(seconds):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            ready, _, _ = select.select([master], [], [], min(0.1, max(0, end - time.monotonic())))
            if ready:
                try:
                    chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                output.extend(chunk)

    try:
        deadline = time.monotonic() + 25
        while not (root / "checklist.json").exists() and time.monotonic() < deadline and proc.poll() is None:
            drain(0.2)
        assert (root / "checklist.json").exists(), "TUI did not load extensions"
        drain(1)
        os.write(master, b"/researcher resume\r")
        deadline = time.monotonic() + 25
        completed = False
        question_sent = False
        answered_while_running = False
        while time.monotonic() < deadline and proc.poll() is None:
            drain(0.2)
            c = json.loads((root / "checklist.json").read_text())
            if c["control"]["state"] == "waiting" and c["control"]["continuations"] >= 1 and not question_sent:
                os.write(master, b"How much data?\r")
                question_sent = True
            elif question_sent and c["control"]["state"] == "waiting" and any(i["text"] == "How much data?" and i.get("resolution") for i in c["control"]["instructions"]):
                job_files = list((root / ".research/jobs").glob("*/job.json"))
                assert len(job_files) == 1 and json.loads(job_files[0].read_text())["status"] == "running"
                answered_while_running = True
                (root / "release-download").write_text("finish")
            if c["control"]["state"] == "completed":
                completed = True
                break
        drain(0.5)
        text = output.decode(errors="replace")
        assert answered_while_running, "User input was not handled while the background job ran"
        assert c["control"]["continuations"] == 2, "Expected one timer wake and one completion wake"
        assert "expected 42 bytes" in text
        assert completed, "TUI research did not complete"
        assert "Skills: research-task" in text, "First Skill name was not rendered"
        assert "Skills: research-report" in text, "Changed Skill name was not rendered"
        assert "skillInstructions" not in text and "research-checkpoint" not in text, "Hidden checkpoint leaked into TUI"
        assert "/skills/" not in text and "SKILL.md" not in text and "name: research-task" not in text, "Skill paths or contents leaked into TUI"
        assert c["audit"][-1]["reason"] == "All modules accepted"
        print("TUI smoke passed: Skill names rendered and changed; hidden checkpoint, Skill bodies and paths absent; completion audited; timer wake and user question during managed download verified.")
    except Exception:
        # Local deterministic content only; retain terminal evidence for diagnosis.
        fd, name = tempfile.mkstemp(prefix="research-tui-failure-", suffix=".log")
        os.close(fd)
        log = Path(name)
        log.write_bytes(output)
        print(f"Terminal capture: {log}")
        raise
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
        os.close(master)
