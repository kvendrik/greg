#!/usr/bin/env python3
"""
CLI to send tasks to a running browser-use server.
Start the server first:  bun run browser-use:server

  bun run browser-use "search for X"
  bun run browser-use go to example.com and take a screenshot
  bun run browser-use status   # show current URL and if a task is running
  bun run browser-use stop     # stop the server

  BROWSER_USE_URL  server URL (default http://127.0.0.1:8765)
"""
import sys
import os
import json
import urllib.request
import urllib.error


def main():
    if len(sys.argv) < 2:
        print(
            "Usage: browser-use <task> | browser-use status | browser-use stop\n"
            "Example: bun run browser-use \"search for browser-use\"\n\n"
            "Start the server first: bun run browser-use:server",
            file=sys.stderr,
        )
        sys.exit(1)

    base_url = os.environ.get("BROWSER_USE_URL", "http://127.0.0.1:8765").rstrip("/")
    first = sys.argv[1].lower()

    if first == "stop":
        url = f"{base_url}/stop"
        body = b"{}"
    elif first == "status":
        url = f"{base_url}/status"
        body = None
    else:
        task = " ".join(sys.argv[1:])
        url = f"{base_url}/task"
        body = json.dumps({"task": task}).encode("utf-8")

    if body is not None:
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
    else:
        req = urllib.request.Request(url, method="GET")

    try:
        with urllib.request.urlopen(req, timeout=3600) as resp:
            if first == "stop":
                data = json.loads(resp.read().decode())
                if not data.get("ok"):
                    print(data.get("error", "Unknown error"), file=sys.stderr)
                    sys.exit(1)
                print("Server stopped.")
                return
            if first == "status":
                data = json.loads(resp.read().decode())
                if not data.get("ok"):
                    print(data.get("error", "Unknown error"), file=sys.stderr)
                    sys.exit(1)
                url_val = data.get("url")
                task_running = data.get("task_running", False)
                print("Task running: yes" if task_running else "Task running: no")
                print(f"URL: {url_val if url_val else '(none)'}")
                return
            # Stream task output line by line
            buffer = b""
            result = None
            while True:
                chunk = resp.read(8192)
                if not chunk:
                    break
                buffer += chunk
                while b"\n" in buffer or (not chunk and buffer):
                    if b"\n" in buffer:
                        line, buffer = buffer.split(b"\n", 1)
                    else:
                        line, buffer = buffer, b""
                    line = line.decode("utf-8", errors="replace")
                    if line.strip().startswith('{"_result":'):
                        try:
                            result = json.loads(line)
                            break
                        except json.JSONDecodeError:
                            print(line, end="")
                            sys.stdout.flush()
                    else:
                        print(line, end="")
                        sys.stdout.flush()
                if result is not None:
                    break
            if result is None and buffer:
                line = buffer.decode("utf-8", errors="replace")
                if line.strip().startswith('{"_result":'):
                    try:
                        result = json.loads(line)
                    except json.JSONDecodeError:
                        print(line, end="")
                        sys.stdout.flush()
                else:
                    print(line, end="")
                    sys.stdout.flush()
            if result is not None:
                payload = result.get("_result", result)
                if not payload.get("ok"):
                    print(payload.get("error", "Unknown error"), file=sys.stderr)
                    sys.exit(1)
                print("Task completed.")
            else:
                print("Stream ended without result.", file=sys.stderr)
                sys.exit(1)
    except urllib.error.URLError as e:
        if getattr(e, "code", None) is not None and hasattr(e, "read"):
            try:
                err_body = e.read().decode()
                data = json.loads(err_body)
                print(data.get("error", err_body), file=sys.stderr)
            except Exception:
                print(e, file=sys.stderr)
        else:
            print(
                "Cannot reach browser-use server. Start it with: bun run browser-use:server",
                file=sys.stderr,
            )
        sys.exit(1)
    except Exception as e:
        print(e, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
