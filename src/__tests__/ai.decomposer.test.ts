import { describe, it, expect, vi } from 'vitest';
import type OpenAI from 'openai';
import { decompose } from '../services/ai/decomposer';

function makeClient(responseText: string): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: responseText } }],
          usage: { prompt_tokens: 50, completion_tokens: 10 },
        }),
      },
    },
  } as unknown as OpenAI;
}

describe('decompose', () => {
  it('returns single instruction unchanged', async () => {
    const client = makeClient('{"instructions":["sort page 1 alphabetically"]}');
    const result = await decompose('sort page 1 alphabetically', client);
    expect(result.instructions).toEqual(['sort page 1 alphabetically']);
  });

  it('splits compound instruction into multiple', async () => {
    const client = makeClient('{"instructions":["group browsers","group text editors"]}');
    const result = await decompose('group browsers and text editors', client);
    expect(result.instructions).toEqual(['group browsers', 'group text editors']);
  });

  it('caps at 5 sub-instructions', async () => {
    const client = makeClient('{"instructions":["a","b","c","d","e","f","g"]}');
    const result = await decompose('lots of things', client);
    expect(result.instructions).toHaveLength(5);
  });

  it('falls back to original instruction on invalid JSON', async () => {
    const client = makeClient('this is not json');
    const result = await decompose('group browsers', client);
    expect(result.instructions).toEqual(['group browsers']);
  });

  it('falls back to original instruction on empty array', async () => {
    const client = makeClient('{"instructions":[]}');
    const result = await decompose('group browsers', client);
    expect(result.instructions).toEqual(['group browsers']);
  });

  it('filters out non-string entries', async () => {
    const client = makeClient('{"instructions":["group browsers", 42, null, "sort page 1"]}');
    const result = await decompose('group browsers and sort page 1', client);
    expect(result.instructions).toEqual(['group browsers', 'sort page 1']);
  });

  it('returns token counts', async () => {
    const client = makeClient('{"instructions":["group browsers"]}');
    const result = await decompose('group browsers', client);
    expect(result.inputTokens).toBe(50);
    expect(result.outputTokens).toBe(10);
  });
});
