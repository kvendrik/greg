from browser_use import Agent, Browser, ChatBrowserUse
#from browser_use import ChatGoogle  # ChatGoogle(model='gemini-3-flash-preview')
#from browser_use import ChatAnthropic  # ChatAnthropic(model='claude-sonnet-4-6')
import asyncio
import sys
import os
import subprocess
from pathlib import Path

async def main():
    if len(sys.argv) < 2:
        print("Error: Prompt is required as a command line argument. Usage: browser-use <task_prompt>", file=sys.stderr)
        sys.exit(1)
    
    prompt = ' '.join(sys.argv[1:])

    print("Prompt: \""+prompt+"\"")

    workspace_path = os.environ.get('WORKSPACE_PATH')

    if not workspace_path:
        raise ValueError('WORKSPACE_PATH environment variable is not set')
    
    workspace_path = os.path.expanduser(workspace_path)
    user_data_dir = Path(workspace_path) / 'browser' / 'data'
    
    # Ensure the directory exists
    user_data_dir.mkdir(parents=True, exist_ok=True)

    browser = Browser(
        user_data_dir=str(user_data_dir)
    )

    agent = Agent(
        task=prompt,
        llm=ChatBrowserUse(model='bu-2-0'),
        browser=browser,
    )

    await agent.run()

if __name__ == "__main__":
    asyncio.run(main())
