import { describe, it, expect, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import { executeGroup, executeMoveToPage, executeRenamePage, executeRenameGroup, executeUngroup } from '../services/ai/executor';
import type { ClassifiedAction } from '../services/ai/classifier';
import type { Grid } from '../schemas/ai.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(responseText: string): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: responseText } }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      },
    },
  } as unknown as OpenAI;
}

function baseCA(overrides: Partial<ClassifiedAction> = {}): ClassifiedAction {
  return {
    action: 'create_group',
    confidence: 0.95,
    filter: 'games',
    filterType: 'semantic',
    targetPage: 1,
    sourcePage: null,
    groupName: null,
    newName: null,
    sortOrder: null,
    reason: null,
    ...overrides,
  };
}

const SIMPLE_GRID: Grid = {
  pages: [
    {
      page: 1,
      title: 'Main',
      apps: [
        { id: 50, name: 'Games', bundle: 'com.apple.gamecenter' },
        { id: 96, name: 'Minecraft', bundle: 'com.mojang.minecraft' },
        { id: 133, name: 'Steam', bundle: 'com.valvesoftware.steam' },
        { id: 142, name: 'TextEdit', bundle: 'com.apple.TextEdit' },
        { id: 181, name: 'Sublime Text', bundle: 'com.sublimetext.3' },
      ],
      groups: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// executeGroup — group name inference
// ---------------------------------------------------------------------------

describe('executeGroup — group name', () => {
  it('uses group name returned by the LLM when classifier sends null', async () => {
    const client = makeClient(JSON.stringify({
      name: 'Games',
      apps: [50, 96, 133],
      success: true,
      confidence: 0.98,
      reason: '',
    }));

    const result = await executeGroup(baseCA({ groupName: null }), SIMPLE_GRID, client, 'gpt-4.1-mini');

    expect(result.success).toBe(true);
    expect((result.mutations as any).groupName).toBe('Games');
  });

  it('uses the classifier-supplied group name when provided', async () => {
    const client = makeClient(JSON.stringify({
      name: 'Gaming',
      apps: [50, 96, 133],
      success: true,
      confidence: 0.98,
      reason: '',
    }));

    const result = await executeGroup(baseCA({ groupName: 'Gaming' }), SIMPLE_GRID, client, 'gpt-4.1-mini');

    expect((result.mutations as any).groupName).toBe('Gaming');
  });

  it('falls back to "New Group" only when both classifier and LLM return no name', async () => {
    const client = makeClient(JSON.stringify({
      name: '',
      apps: [50, 96, 133],
      success: true,
      confidence: 0.95,
      reason: '',
    }));

    const result = await executeGroup(baseCA({ groupName: null }), SIMPLE_GRID, client, 'gpt-4.1-mini');

    expect((result.mutations as any).groupName).toBe('New Group');
  });
});

// ---------------------------------------------------------------------------
// executeGroup — distinct groups don't collide
// ---------------------------------------------------------------------------

describe('executeGroup — no group name collision', () => {
  it('two sequential create_group calls produce distinct group names', async () => {
    const gamesClient = makeClient(JSON.stringify({
      name: 'Games', apps: [50, 96, 133], success: true, confidence: 0.98, reason: '',
    }));
    const editorsClient = makeClient(JSON.stringify({
      name: 'Text Editors', apps: [142, 181], success: true, confidence: 0.95, reason: '',
    }));

    const gamesResult = await executeGroup(
      baseCA({ filter: 'games', groupName: null }),
      SIMPLE_GRID,
      gamesClient,
      'gpt-4.1-mini'
    );
    const editorsResult = await executeGroup(
      baseCA({ filter: 'text editors', groupName: null }),
      SIMPLE_GRID,
      editorsClient,
      'gpt-4.1-mini'
    );

    const gamesName = (gamesResult.mutations as any).groupName;
    const editorsName = (editorsResult.mutations as any).groupName;

    expect(gamesName).not.toBe(editorsName);
    expect(gamesName).toBe('Games');
    expect(editorsName).toBe('Text Editors');
  });
});

// ---------------------------------------------------------------------------
// executeGroup — source_page candidate pool
// ---------------------------------------------------------------------------

describe('executeGroup — source_page candidate pool', () => {
  const MULTI_PAGE_GRID: Grid = {
    pages: [
      {
        page: 1,
        title: 'Main',
        apps: [
          { id: 50, name: 'Games', bundle: 'com.apple.gamecenter' },
          { id: 96, name: 'Minecraft', bundle: 'com.mojang.minecraft' },
        ],
        groups: [],
      },
      {
        page: 2,
        title: 'Work',
        apps: [
          { id: 142, name: 'TextEdit', bundle: 'com.apple.TextEdit' },
          { id: 181, name: 'Sublime Text', bundle: 'com.sublimetext.3' },
        ],
        groups: [],
      },
    ],
  };

  it('restricts candidate pool to source_page when set', async () => {
    const client = makeClient(JSON.stringify({
      name: 'Games', apps: [50, 96], success: true, confidence: 0.98, reason: '',
    }));

    await executeGroup(
      baseCA({ filter: 'games', sourcePage: 1 }),
      MULTI_PAGE_GRID,
      client,
      'gpt-4.1-mini'
    );

    const callArg = (client.chat.completions.create as any).mock.calls[0][0];
    const userMsg: string = callArg.messages[1].content;

    // Only page 1 apps should appear in the prompt
    expect(userMsg).toContain('Games');
    expect(userMsg).toContain('Minecraft');
    expect(userMsg).not.toContain('TextEdit');
    expect(userMsg).not.toContain('Sublime Text');
  });

  it('searches all pages when source_page is null', async () => {
    const client = makeClient(JSON.stringify({
      name: 'Games', apps: [50, 96], success: true, confidence: 0.98, reason: '',
    }));

    await executeGroup(
      baseCA({ filter: 'games', sourcePage: null }),
      MULTI_PAGE_GRID,
      client,
      'gpt-4.1-mini'
    );

    const callArg = (client.chat.completions.create as any).mock.calls[0][0];
    const userMsg: string = callArg.messages[1].content;

    expect(userMsg).toContain('Games');
    expect(userMsg).toContain('TextEdit');
  });
});

// ---------------------------------------------------------------------------
// executeGroup — LLM returns JSON with comments
// ---------------------------------------------------------------------------

describe('executeGroup — JSON with comments', () => {
  it('parses LLM response that contains // line comments', async () => {
    const responseWithComments = `{
  "name": "Communication Apps",
  "apps": [
    305,   // Discord
    306,   // Slack
    307    // Teams
  ],
  "success": true,
  "confidence": 0.95,
  "reason": ""
}`;
    const client = makeClient(responseWithComments);
    const result = await executeGroup(baseCA({ filter: 'communication apps', groupName: 'Communication Apps' }), SIMPLE_GRID, client, 'gpt-4.1');

    // IDs 305-307 are not in SIMPLE_GRID so they'll be filtered, but parsing must not throw
    expect(result.success).toBe(false); // no valid IDs
    expect(result.mutations).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// executeGroup — no matches
// ---------------------------------------------------------------------------

describe('executeGroup — no matches', () => {
  it('returns success=false when LLM finds no matching apps', async () => {
    const client = makeClient(JSON.stringify({
      name: 'Games', apps: [], success: false, confidence: 0.5, reason: 'No games found',
    }));

    const result = await executeGroup(baseCA(), SIMPLE_GRID, client, 'gpt-4.1-mini');

    expect(result.success).toBe(false);
    expect(result.mutations).toBeNull();
  });

  it('filters out hallucinated IDs not present in the grid', async () => {
    const client = makeClient(JSON.stringify({
      name: 'Games', apps: [50, 9999], success: true, confidence: 0.95, reason: '',
    }));

    const result = await executeGroup(baseCA(), SIMPLE_GRID, client, 'gpt-4.1-mini');

    expect((result.mutations as any).appIds).toEqual([50]);
  });
});

// ---------------------------------------------------------------------------
// executeMoveToPage
// ---------------------------------------------------------------------------

describe('executeMoveToPage', () => {
  const GRID: Grid = {
    pages: [
      {
        page: 1,
        apps: [
          { id: 1, name: 'Chrome', bundle: 'com.google.Chrome' },
          { id: 2, name: 'Firefox', bundle: 'org.mozilla.firefox' },
        ],
        groups: [],
      },
      {
        page: 2,
        apps: [
          { id: 101, name: 'Spotify', bundle: 'com.spotify.client' },
          { id: 102, name: 'Music', bundle: 'com.apple.Music' },
        ],
        groups: [],
      },
    ],
  };

  it('returns correct appIds and targetPage from LLM moves', async () => {
    const client = makeClient(JSON.stringify({
      moves: [{ id: 101, name: 'Spotify', to_page: 1 }, { id: 102, name: 'Music', to_page: 1 }],
      success: true,
      confidence: 0.98,
      reason: '',
    }));

    const ca = baseCA({ action: 'move_to_page', filter: 'music apps', targetPage: 1, groupName: null });
    const result = await executeMoveToPage(ca, GRID, client, 'gpt-4.1-mini', 35);

    expect(result.success).toBe(true);
    expect((result.mutations as any).appIds).toEqual([101, 102]);
    expect((result.mutations as any).targetPage).toBe(1);
  });

  it('filters out hallucinated IDs not present in the grid', async () => {
    const client = makeClient(JSON.stringify({
      moves: [{ id: 101, name: 'Spotify', to_page: 1 }, { id: 9999, name: 'Ghost', to_page: 1 }],
      success: true,
      confidence: 0.95,
      reason: '',
    }));

    const ca = baseCA({ action: 'move_to_page', filter: 'music apps', targetPage: 1, groupName: null });
    const result = await executeMoveToPage(ca, GRID, client, 'gpt-4.1-mini', 35);

    expect((result.mutations as any).appIds).toEqual([101]);
  });

  it('is deterministic when source_page is set with no filter (no LLM call)', async () => {
    const client = makeClient('should not be called');
    const ca = baseCA({ action: 'move_to_page', sourcePage: 1, targetPage: 2, filter: null, filterType: null, groupName: null });
    const result = await executeMoveToPage(ca, GRID, client, 'gpt-4.1-mini', 35);

    expect(client.chat.completions.create).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect((result.mutations as any).appIds).toEqual([1, 2]);
    expect((result.mutations as any).targetPage).toBe(2);
  });

  it('deterministic path includes apps inside groups on the source page', async () => {
    const gridWithGroup: Grid = {
      pages: [{
        page: 1,
        apps: [{ id: 1, name: 'Chrome', bundle: 'com.google.Chrome' }],
        groups: [{ id: 200, name: 'Comms', apps: [{ id: 50, name: 'Slack', bundle: 'com.tinyspeck.slackmacgap' }] }],
      }],
    };
    const client = makeClient('should not be called');
    const ca = baseCA({ action: 'move_to_page', sourcePage: 1, targetPage: 2, filter: null, filterType: null, groupName: null });
    const result = await executeMoveToPage(ca, gridWithGroup, client, 'gpt-4.1-mini', 35);

    expect(client.chat.completions.create).not.toHaveBeenCalled();
    expect((result.mutations as any).appIds).toContain(1);   // loose app
    expect((result.mutations as any).appIds).toContain(50);  // app inside group
  });

  it('falls through to LLM when source_page is set but filter is also present', async () => {
    const client = makeClient(JSON.stringify({
      moves: [{ id: 1, name: 'Chrome', to_page: 2 }],
      success: true, confidence: 0.95, reason: '',
    }));
    const ca = baseCA({ action: 'move_to_page', sourcePage: 1, targetPage: 2, filter: 'browsers', filterType: 'semantic', groupName: null });
    const result = await executeMoveToPage(ca, GRID, client, 'gpt-4.1-mini', 35);

    expect(client.chat.completions.create).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('returns success=false when source_page does not exist', async () => {
    const client = makeClient('should not be called');
    const ca = baseCA({ action: 'move_to_page', sourcePage: 99, targetPage: 2, filter: null, filterType: null, groupName: null });
    const result = await executeMoveToPage(ca, GRID, client, 'gpt-4.1-mini', 35);

    expect(result.success).toBe(false);
    expect(result.mutations).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deterministic executors
// ---------------------------------------------------------------------------

describe('executeRenamePage', () => {
  const grid: Grid = {
    pages: [{ page: 1, title: 'Main', apps: [], groups: [] }],
  };

  it('returns correct mutation for valid rename', () => {
    const ca = baseCA({ action: 'rename_page', targetPage: 1, newName: 'Work', filter: null, filterType: null });
    const result = executeRenamePage(ca, grid);
    expect(result.success).toBe(true);
    expect((result.mutations as any).newName).toBe('Work');
    expect((result.mutations as any).page).toBe(1);
  });

  it('returns success=false when page not found', () => {
    const ca = baseCA({ action: 'rename_page', targetPage: 99, newName: 'Work', filter: null, filterType: null });
    const result = executeRenamePage(ca, grid);
    expect(result.success).toBe(false);
  });

  it('returns success=false when new name is missing', () => {
    const ca = baseCA({ action: 'rename_page', targetPage: 1, newName: null, filter: null, filterType: null });
    const result = executeRenamePage(ca, grid);
    expect(result.success).toBe(false);
  });
});

describe('executeUngroup', () => {
  const grid: Grid = {
    pages: [{
      page: 1,
      apps: [],
      groups: [
        { id: 200, name: 'Browsers', apps: [
          { id: 1, name: 'Chrome', bundle: 'com.google.Chrome' },
          { id: 2, name: 'Firefox', bundle: 'org.mozilla.firefox' },
        ]},
      ],
    }],
  };

  it('returns correct groupName mutation for an existing group', () => {
    const ca = baseCA({ action: 'ungroup', groupName: 'Browsers', filter: null, filterType: null });
    const result = executeUngroup(ca, grid);
    expect(result.success).toBe(true);
    expect((result.mutations as any).groupName).toBe('Browsers');
    expect(result.inputTokens).toBe(0); // deterministic — no LLM
  });

  it('is case-insensitive when matching group name', () => {
    const ca = baseCA({ action: 'ungroup', groupName: 'browsers', filter: null, filterType: null });
    const result = executeUngroup(ca, grid);
    expect(result.success).toBe(true);
  });

  it('returns success=false when group does not exist', () => {
    const ca = baseCA({ action: 'ungroup', groupName: 'Games', filter: null, filterType: null });
    const result = executeUngroup(ca, grid);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/not found/i);
    expect(result.mutations).toBeNull();
  });

  it('returns success=false when no group name provided', () => {
    const ca = baseCA({ action: 'ungroup', groupName: null, filter: null, filterType: null });
    const result = executeUngroup(ca, grid);
    expect(result.success).toBe(false);
  });
});

describe('executeRenameGroup', () => {
  const grid: Grid = {
    pages: [{
      page: 1,
      apps: [],
      groups: [{ id: 200, name: 'Browsers', apps: [] }],
    }],
  };

  it('returns correct mutation for valid group rename', () => {
    const ca = baseCA({ action: 'rename_group', groupName: 'Browsers', newName: 'Web Browsers', filter: null, filterType: null });
    const result = executeRenameGroup(ca, grid);
    expect(result.success).toBe(true);
    expect((result.mutations as any).currentName).toBe('Browsers');
    expect((result.mutations as any).newName).toBe('Web Browsers');
  });

  it('returns success=false when group does not exist', () => {
    const ca = baseCA({ action: 'rename_group', groupName: 'Games', newName: 'Gaming', filter: null, filterType: null });
    const result = executeRenameGroup(ca, grid);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/not found/i);
  });
});
