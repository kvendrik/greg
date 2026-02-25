import sys
import json
import asyncio
from browser_use import Agent, Browser

EXTEND_SYSTEM_MESSAGE = (
    "If the page or task requires login, account access, or other credentials you do not have, "
    "do not keep trying. Finish immediately and report clearly that you lack the required credentials. "
    "Do not attempt to guess credentials or prompt for them in the browser."
)

async def read_stdin():
    """Async wrapper around blocking stdin reads."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, sys.stdin.readline)

async def main():
    # Use your actual Chrome profile (close Chrome first to avoid profile lock)
    browser = Browser.from_system_chrome(keep_alive=True, headless=False, profile_directory='Default')
    await browser.start()
    agent = None
    current_task: asyncio.Task | None = None

    while True:
        line = await read_stdin()
        if not line:
            break

        line = line.strip()
        if not line:
            continue

        msg = json.loads(line)
        action = msg.get("action", "task")

        # Abort the currently running agent task
        if action == "abort":
            if current_task and not current_task.done():
                current_task.cancel()
                try:
                    await current_task
                except asyncio.CancelledError:
                    pass
                sys.stdout.write(json.dumps({ "status": "aborted" }) + "\n")
                sys.stdout.flush()
            else:
                sys.stdout.write(json.dumps({ "status": "nothing_to_abort" }) + "\n")
                sys.stdout.flush()
            continue

        # Run a new task
        task = msg["task"]

        async def run(t):
            nonlocal agent
            if agent is None:
                agent = Agent(
                    task=t,
                    browser_session=browser,
                    extend_system_message=EXTEND_SYSTEM_MESSAGE,
                )
            else:
                agent.add_new_task(t)
            await agent.run()

        current_task = asyncio.create_task(run(task))

        try:
            await current_task
            result = agent.history.final_result()
            sys.stdout.write(json.dumps({ "status": "ok", "result": result }) + "\n")
        except asyncio.CancelledError:
            # Already handled above, but catch here in case abort races with completion
            pass
        except Exception as e:
            sys.stdout.write(json.dumps({ "status": "error", "result": str(e) }) + "\n")
        finally:
            sys.stdout.flush()

    await browser.kill()

asyncio.run(main())
