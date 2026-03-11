import { mkdtemp, rm } from 'node:fs/promises';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { applyPatchString } from '../files';

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

describe('files tool', () => {
  describe('applyPatchString()', () => {
    it('applies an Add File patch', async () => {
    const dir = await createTempDir('patch-file-add-');
    const target = join(dir, 'foo.ts');

    const patch = [
      '*** Begin Patch',
      `*** Add File: ${target}`,
      '@@',
      '+export const foo = 1;',
      '*** End Patch',
    ].join('\n');

      try {
        await applyPatchString(patch);
        const content = await fs.readFile(target, 'utf8');
        expect(content).toBe('export const foo = 1;');
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('applies an Update File patch with matching context', async () => {
    const dir = await createTempDir('patch-file-update-');
    const target = join(dir, 'bar.ts');
    await fs.writeFile(target, 'const x = 1;\nconst y = 2;\n', 'utf8');

    const patch = [
      '*** Begin Patch',
      `*** Update File: ${target}`,
      '@@',
      ' const x = 1;',
      '-const y = 2;',
      '+const y = 3;',
      '*** End Patch',
    ].join('\n');

      try {
        await applyPatchString(patch);
        const content = await fs.readFile(target, 'utf8');
        const expected = 'const x = 1;\nconst y = 3;\n';
        expect(content).toBe(expected);
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it('throws on context mismatch', async () => {
    const dir = await createTempDir('patch-file-mismatch-');
    const target = join(dir, 'baz.ts');
    await fs.writeFile(target, 'abc\n', 'utf8');

    const patch = [
      '*** Begin Patch',
      `*** Update File: ${target}`,
      '@@',
      ' def',
      '*** End Patch',
    ].join('\n');

      try {
        await expect(applyPatchString(patch)).rejects.toThrow(
          'Context line mismatch'
        );
      } finally {
        await cleanupTempDir(dir);
      }
    });
  });
});

