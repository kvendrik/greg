export async function ping() {
  try {
    const res = await fetch('http://localhost:3000/ping');
    return res.ok;
  } catch (error) {
    return false;
  }
}

export async function abort() {
  const res = await fetch('http://localhost:3000/abort', {
    method: 'POST',
  });
  return res.ok;
}

export async function prompt(
  prompt: string,
  {
    onThinking,
    onContent,
    onDone,
  }: {
    onThinking: (chunk: string) => void;
    onContent: (chunk: string) => void;
    onDone: () => void;
  }
) {
  const res = await fetch('http://localhost:3000/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Error ${res.status}: ${text}`);
    process.exit(1);
  }

  if (!res.body) {
    console.error('No response body');
    process.exit(1);
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
        } catch {
          // ignore
        }
      }
      break;
    }
  }

  onDone();
}
