import { describe, expect, it } from 'bun:test';

import { createConfigBuilder } from '../config-builder';

describe('createConfigBuilder', () => {
  it('get() removes placeholders and keeps scaffold', async () => {
    const builder = createConfigBuilder();

    const output = await builder.get();
    expect(output).not.toContain('[...]');
    expect(output).not.toContain('[T...]');
    expect(output).toContain("from '@kvendrik/greg/config'");
    expect(output).toContain('heartbeat:');
    expect(output).toContain('tools:');
    expect(output).toContain('guard:');
  });

  it('add() with default position inserts at root before heartbeat', async () => {
    const builder = createConfigBuilder();
    builder.add('models', '[]');

    const output = await builder.get();
    expect(output).toContain('models: [],');
    expect(output.indexOf('models:')).toBeLessThan(output.indexOf('heartbeat:'));
    expect(output).not.toContain('[...]');
  });

  it('add(..., "root") matches omitted position', async () => {
    const explicit = createConfigBuilder();
    explicit.add('a', '1', 'root');
    const implicit = createConfigBuilder();
    implicit.add('a', '1');

    const outputExplicit = await explicit.get();
    const outputImplicit = await implicit.get();
    expect(outputExplicit).toBe(outputImplicit);
  });

  it('chains multiple root entries before heartbeat', async () => {
    const builder = createConfigBuilder();
    builder.add('models', '[]');
    builder.add('telegram', '{}');

    const output = await builder.get();
    expect(output).toContain('models: [],');
    expect(output).toContain('telegram: {},');
    expect(output.indexOf('models:')).toBeLessThan(output.indexOf('telegram:'));
    expect(output.indexOf('telegram:')).toBeLessThan(output.indexOf('heartbeat:'));
  });

  it('add(..., "tool") inserts inside tools before guard', async () => {
    const builder = createConfigBuilder();
    builder.add('webSearch', `{ provider: 'brave' }`, 'tool');

    const output = await builder.get();
    expect(output).toContain(`webSearch: { provider: 'brave' },`);
    expect(output.indexOf('tools:')).toBeLessThan(output.indexOf('webSearch:'));
    expect(output.indexOf('webSearch:')).toBeLessThan(output.indexOf('guard:'));
    expect(output).not.toContain('[T...]');
  });

  it('supports root then tool like quickstart flow', async () => {
    const builder = createConfigBuilder();
    builder.add('models', '[]');
    builder.add('webSearch', '{}', 'tool');

    const output = await builder.get();
    expect(output).toContain('models: [],');
    expect(output).toContain('webSearch: {},');
    expect(output.indexOf('models:')).toBeLessThan(output.indexOf('heartbeat:'));
    expect(output.indexOf('webSearch:')).toBeLessThan(output.indexOf('guard:'));
  });
});
