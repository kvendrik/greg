import config from '../.greg';

const BASE = `http://localhost:${config.port}`;

type PromptCallbacks = {
  onThinking: (chunk: string) => void;
  onContent: (chunk: string) => void;
  onToolcall: (name: string, args: Record<string, unknown>) => void;
  onDone: () => void;
  onError: (error: string) => void;
};

export type PromptInput = {
  content: string;
  images: { data: string; mimeType: string }[];
};

export type Thread = {
  id: string;
  abort(): Promise<boolean>;
  destroy(): Promise<boolean>;
  prompt(input: PromptInput, callbacks: PromptCallbacks): Promise<void>;
};

export async function ping() {
  try {
    const res = await fetch(`${BASE}/ping`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function createThread(): Promise<Thread> {
  const res = await fetch(`${BASE}/threads/new`, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create thread: ${res.status} ${text}`);
  }

  const { id } = (await res.json()) as { id: string };
  let destroyed = false;

  return {
    id,
    abort() {
      return abort(id);
    },
    async destroy() {
      if (destroyed) return true;
      destroyed = true;
      return destroyThread(id);
    },
    prompt(input, callbacks) {
      return prompt(id, input, callbacks);
    },
  };
}

async function abort(threadId: string) {
  const res = await fetch(`${BASE}/threads/${threadId}/abort`, {
    method: 'POST',
  });
  return res.ok;
}

async function destroyThread(threadId: string) {
  const res = await fetch(`${BASE}/threads/${threadId}`, {
    method: 'DELETE',
  });
  return res.ok;
}

async function prompt(
  threadId: string,
  input: PromptInput,
  { onThinking, onContent, onToolcall, onDone, onError }: PromptCallbacks
) {
  const res = await fetch(`${BASE}/threads/${threadId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: input }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Prompt failed: ${res.status} ${text}`);
  }

  if (!res.body) {
    throw new Error('No response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();

    if (value?.length) {
      buffer += decoder.decode(value, { stream: true });
    }

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.type === 'content') {
          onContent(data.chunk ?? '');
        } else if (data.type === 'thinking') {
          onThinking(data.chunk ?? '');
        } else if (data.type === 'toolcall') {
          onToolcall(data.name ?? '', JSON.parse(data.args ?? '{}'));
        } else if (data.type === 'error') {
          onError?.(data.error ?? String(data));
        }
      } catch {
        // Skip malformed lines; don't mix parse errors into content
      }
    }

    if (done) {
      buffer += decoder.decode();
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          if (data.type === 'content') onContent(data.chunk ?? '');
          else if (data.type === 'thinking') onThinking(data.chunk ?? '');
          else if (data.type === 'toolcall')
            onToolcall(data.name ?? '', JSON.parse(data.args ?? '{}'));
          else if (data.type === 'error') onError?.(data.error ?? String(data));
        } catch {
          // ignore
        }
      }
      break;
    }
  }
  onDone();
}
