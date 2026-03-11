## Server connection

- `GET /ping` → health check, returns `{ "status": "ok" }`.
- `POST /sessions/new` → creates a new session, returns `{ "id": "<session-id>" }`.
- `DELETE /sessions/:id` → deletes a session.

- `ws://localhost:<PORT>/sessions/:id` to send a prompt and receive responses.
  - Send:
    - Prompt: `{ "type": "prompt", "prompt": { "content": "Hi", "images": [] } }`
    - Abort: `{ "type": "abort" }`
    - Delete session: `{ "type": "delete" }`
  - Receive:
    - Content: `{ "type": "content", "chunk": "Hello!" }`
    - Thinking: `{ "type": "thinking", "chunk": "Planning next steps..." }`
    - Tool call: `{ "type": "toolcall", "name": "my_tool", "args": "{\"foo\":\"bar\"}" }`
    - Done: `{ "type": "done" }`
    - Stopped: `{ "type": "stopped" }`
    - Error: `{ "type": "error", "error": "Human readable error message" }`
