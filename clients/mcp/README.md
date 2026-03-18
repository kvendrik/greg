# MCP Server

Exposes Greg as an [MCP](https://modelcontextprotocol.io/) tool over stdio. Works with Cursor, Claude Desktop, and any MCP-compatible client.

## Setup

Add to your Cursor MCP config (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "greg": {
      "command": "bun",
      "args": ["run", "clients/mcp/index.ts"],
      "cwd": "/absolute/path/to/greg"
    }
  }
}
```

## Usage from code

Spawn the server as a child process and talk to it using the MCP client SDK:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", "clients/mcp/index.ts"],
});

const client = new Client({ name: "my-cli", version: "1.0.0" });
await client.connect(transport);

// Stream output as it arrives via progress notifications
const result = await client.callTool(
  { name: "prompt", arguments: { message: "What's on my schedule today?" } },
  undefined,
  {
    onprogress: (progress) => {
      if (progress.message) process.stdout.write(progress.message);
    },
    timeout: 300_000,
    resetTimeoutOnProgress: true,
  }
);

console.log(result.content);

// Abort a running prompt from another call
await client.callTool({ name: "stop" });

await client.close();
```

## Tools

**`prompt`** — Send a message to Greg and get a response. Streams content chunks as `notifications/progress` while running. The final result contains the full text.

```
message: string — The message to send to Greg
```

**`stop`** — Abort the currently running prompt. Returns immediately. No-op if Greg is idle.

**`status`** — Check whether Greg is currently working on a task.
