import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import uuid

MAX_INPUT_LENGTH = 2 * 1024 * 1024


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--token", required=True)
    parser.add_argument("--inbox", required=True)
    parser.add_argument("--distro", default="")
    args = parser.parse_args()
    event_name = ""
    try:
        if len(args.token) != 64 or any(value not in "0123456789abcdefABCDEF" for value in args.token):
            return 0
        raw = sys.stdin.buffer.read(MAX_INPUT_LENGTH + 1)
        if not raw or len(raw) > MAX_INPUT_LENGTH:
            return 0
        source = json.loads(raw)
        event_name = source.get("hook_event_name", "")
        session_id = source.get("session_id", "")
        if not isinstance(event_name, str) or not isinstance(session_id, str) or not event_name or not session_id:
            return 0
        payload = {
            "hook_event_name": event_name,
            "session_id": session_id,
            "cwd": source.get("cwd", "") if isinstance(source.get("cwd", ""), str) else "",
            "tool_name": source.get("tool_name", "") if isinstance(source.get("tool_name", ""), str) else "",
            "runtime": "wsl",
            "distro": args.distro,
        }
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        signature = hmac.new(bytes.fromhex(args.token), body.encode("utf-8"), hashlib.sha256).hexdigest()
        os.makedirs(args.inbox, exist_ok=True)
        name = f"{time.time_ns()}-{os.getpid()}-{uuid.uuid4().hex}.json"
        temporary = os.path.join(args.inbox, f".{name}.tmp")
        target = os.path.join(args.inbox, name)
        with open(temporary, "x", encoding="utf-8") as output:
            json.dump({"body": body, "signature": signature}, output, ensure_ascii=False, separators=(",", ":"))
        os.replace(temporary, target)
    except Exception:
        pass
    finally:
        if event_name in ("Stop", "SubagentStop"):
            sys.stdout.write("{}")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
