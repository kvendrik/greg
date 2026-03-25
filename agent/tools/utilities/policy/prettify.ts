/**
 * Convert a tool call into a readable, log-friendly string.
 *
 * @example
 * ```ts
 * prettify('sendEmail', { to: 'a@b.com', token: 'super-secret', tags: ['welcome'] });
 * // => sendEmail({
 * //      "to": "a@b.com",
 * //      "token": "[REDACTED]",
 * //      "tags": [
 * //        "welcome"
 * //      ]
 * //    })
 * ```
 */
export function prettify(
  toolName: string,
  params: Record<string, unknown>
): string {
  const maxStringLength = 250;
  const maxDepth = 6;
  const maxArrayLength = 50;
  const maxObjectKeys = 50;

  const seenObjects = new WeakSet();

  const isSensitiveKey = (key: string): boolean =>
    /(pass(word)?|secret|token|key|api[-_]?key|authorization|cookie|auth)/i.test(
      key
    );

  const sanitize = (
    value: unknown,
    depth: number,
    key: string | null
  ): unknown => {
    if (key !== null && isSensitiveKey(key)) {
      return '[REDACTED]';
    }

    if (typeof value === 'string') {
      if (value.length <= maxStringLength) return value;
      return value.slice(0, maxStringLength) + '...';
    }

    if (
      value === null ||
      value === undefined ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }

    if (typeof value === 'bigint') {
      return `${value.toString()}n`;
    }

    if (typeof value === 'symbol') {
      return value.toString();
    }

    if (typeof value === 'function') {
      return '[Function]';
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
      };
    }

    if (typeof value === 'object') {
      if (depth >= maxDepth) return '[MaxDepth]';

      if (seenObjects.has(value)) return '[Circular]';
      seenObjects.add(value);

      if (Array.isArray(value)) {
        const items = value
          .slice(0, maxArrayLength)
          .map((item) => sanitize(item, depth + 1, null));
        if (value.length <= maxArrayLength) return items;
        return [...items, `[+${value.length - maxArrayLength} more]`];
      }

      const recordValue = value as Record<string, unknown>;
      const keys = Object.keys(recordValue);
      const limitedKeys = keys.slice(0, maxObjectKeys);

      const sanitizedEntries: [string, unknown][] = limitedKeys.map(
        (entryKey) => [
          entryKey,
          sanitize(recordValue[entryKey], depth + 1, entryKey),
        ]
      );

      const sanitizedObject: Record<string, unknown> = {};
      for (const [entryKey, entryValue] of sanitizedEntries) {
        sanitizedObject[entryKey] = entryValue;
      }
      if (keys.length <= maxObjectKeys) return sanitizedObject;

      return {
        ...sanitizedObject,
        '[+more keys]': keys.length - maxObjectKeys,
      };
    }

    return '[Unknown]';
  };

  try {
    const safeParams = sanitize(params, 0, null);
    return `${toolName}(${JSON.stringify(safeParams, null, 2)})`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `${toolName}([Unserializable params: ${errorMessage}])`;
  }
}
