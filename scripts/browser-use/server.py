"""
Server process that keeps a persistent browser and accepts tasks over HTTP.
Run this in the background, then use the browser-use CLI to send tasks.

  bun run browser-use:server
  python scripts/browser-use/server.py [--port 8765]

  BROWSER_USE_PORT=8765  (default 8765)
  WORKSPACE_PATH          required for browser data dir
"""
from browser_use import Agent, Browser, ChatBrowserUse
import asyncio
import argparse
import os
import json
from pathlib import Path

try:
    from aiohttp import web
except ImportError:
    raise SystemExit("Install aiohttp: pip install aiohttp")

# ---------------------------------------------------------------------------
# Browser + agent state (one agent, one browser, tasks serialized)
# ---------------------------------------------------------------------------

browser: Browser | None = None
agent: Agent | None = None
task_lock = asyncio.Lock()
current_run_task: asyncio.Task | None = None  # cancelled when /stop is called


def get_browser() -> Browser:
    if browser is None:
        raise RuntimeError("Browser not started")
    return browser


def get_or_create_agent(first_task: str) -> Agent:
    global agent
    b = get_browser()
    if agent is None:
        agent = Agent(
            task=first_task,
            llm=ChatBrowserUse(model="bu-2-0"),
            browser_session=b,
        )
    else:
        agent.add_new_task(first_task)
    return agent


# ---------------------------------------------------------------------------
# HTTP handlers
# ---------------------------------------------------------------------------

def _make_stream_hooks(stream_queue: asyncio.Queue, step_counter: list[int]):
    """Build on_step_start/on_step_end hooks that push lines to stream_queue."""

    async def on_step_start(agent):
        step_counter[0] += 1
        try:
            state = await agent.browser_session.get_browser_state_summary()
            url = getattr(state, "url", "") or ""
            await stream_queue.put(f"[Step {step_counter[0]}] {url}\n")
        except Exception:
            await stream_queue.put(f"[Step {step_counter[0]}]\n")

    async def on_step_end(agent):
        try:
            urls = list(agent.history.urls()) if hasattr(agent, "history") else []
            if urls:
                await stream_queue.put(f"  → {urls[-1]}\n")
        except Exception:
            pass

    return on_step_start, on_step_end


async def handle_task(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
    task = body.get("task")
    if not task or not isinstance(task, str):
        return web.json_response(
            {"ok": False, "error": "Missing or invalid 'task' (string)"}, status=400
        )
    global current_run_task
    async with task_lock:
        stream_queue: asyncio.Queue = asyncio.Queue()
        step_counter: list[int] = [0]
        on_start, on_end = _make_stream_hooks(stream_queue, step_counter)

        response = web.StreamResponse(
            status=200,
            headers={"Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff"},
        )
        await response.prepare(request)

        async def stream_writer():
            while True:
                line = await stream_queue.get()
                if line is None:
                    break
                await response.write(line.encode("utf-8"))
                try:
                    response.drain()
                except Exception:
                    pass

        writer_task = asyncio.create_task(stream_writer())
        try:
            ag = get_or_create_agent(task.strip())
            run_task = asyncio.create_task(
                ag.run(on_step_start=on_start, on_step_end=on_end)
            )
            current_run_task = run_task
            try:
                await run_task
                await stream_queue.put(json.dumps({"_result": {"ok": True}}) + "\n")
            except asyncio.CancelledError:
                await stream_queue.put(json.dumps({"_result": {"ok": False, "error": "cancelled"}}) + "\n")
            finally:
                current_run_task = None
        except asyncio.CancelledError:
            await stream_queue.put(json.dumps({"_result": {"ok": False, "error": "cancelled"}}) + "\n")
        except Exception as e:
            await stream_queue.put(json.dumps({"_result": {"ok": False, "error": str(e)}}) + "\n")
        finally:
            await stream_queue.put(None)
            await writer_task

        await response.write_eof()
        return response


async def handle_status(_: web.Request) -> web.Response:
    """Return current browser URL and whether a task is running."""
    url = None
    if agent is not None and hasattr(agent, "browser_session"):
        try:
            state = await agent.browser_session.get_browser_state_summary()
            url = getattr(state, "url", None) or None
        except Exception:
            pass
    elif browser is not None and hasattr(browser, "get_browser_state_summary"):
        try:
            state = await browser.get_browser_state_summary()
            url = getattr(state, "url", None) or None
        except Exception:
            pass
    task_running = current_run_task is not None and not current_run_task.done()
    return web.json_response({
        "ok": True,
        "url": url,
        "task_running": task_running,
    })


async def handle_stop(request: web.Request) -> web.Response:
    """Stop the current task (if any) and then shut down the server (browser-use stop)."""
    global current_run_task
    if current_run_task is not None and not current_run_task.done():
        current_run_task.cancel()
        try:
            await asyncio.wait_for(asyncio.shield(current_run_task), timeout=2.0)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
    shutdown = request.app.get("shutdown_future")
    if shutdown and not shutdown.done():
        shutdown.set_result(None)
    return web.json_response({"ok": True})


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

async def start_browser(app: web.Application) -> None:
    global browser
    workspace_path = os.environ.get("WORKSPACE_PATH")
    if not workspace_path:
        raise ValueError("WORKSPACE_PATH environment variable is not set")
    workspace_path = os.path.expanduser(workspace_path)
    user_data_dir = Path(workspace_path) / "browser" / "data"
    user_data_dir.mkdir(parents=True, exist_ok=True)
    browser = Browser(keep_alive=True, user_data_dir=str(user_data_dir))
    await browser.start()


async def stop_browser(app: web.Application) -> None:
    global browser
    if browser is not None:
        await browser.kill()
        browser = None


def main():
    parser = argparse.ArgumentParser(description="Browser-use server (persistent browser + HTTP /task)")
    parser.add_argument("--port", type=int, default=None, help="Port (default: BROWSER_USE_PORT or 8765)")
    args = parser.parse_args()
    port = args.port or int(os.environ.get("BROWSER_USE_PORT", "8765"))

    app = web.Application()
    app["shutdown_future"] = asyncio.Future()
    app.add_routes([
        web.post("/task", handle_task),
        web.get("/status", handle_status),
        web.post("/stop", handle_stop),
    ])
    app.on_startup.append(start_browser)
    app.on_cleanup.append(stop_browser)

    runner = web.AppRunner(app)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(runner.setup())
    site = web.TCPSite(runner, "127.0.0.1", port)
    loop.run_until_complete(site.start())
    print(f"Browser-use server listening on http://127.0.0.1:{port}")
    print("Send tasks with: bun run browser-use \"your task\" | Stop with: bun run browser-use stop")
    try:
        loop.run_until_complete(app["shutdown_future"])
    finally:
        loop.run_until_complete(runner.cleanup())
    loop.close()


if __name__ == "__main__":
    main()
