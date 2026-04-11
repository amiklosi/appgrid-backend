/**
 * ai.routes.test.ts
 *
 * Integration tests for POST /api/ai/rearrange.
 * Both the classifier and executor are mocked — no real OpenAI calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index';
import { prismaMock } from './setup';

// ---------------------------------------------------------------------------
// Mock the OpenAI singleton so no real network calls are made
// ---------------------------------------------------------------------------
vi.mock('../lib/openai', () => ({ openai: {} }));

// ---------------------------------------------------------------------------
// Mock classifier, executor, and decomposer modules
// ---------------------------------------------------------------------------
vi.mock('../services/ai/classifier');
vi.mock('../services/ai/executor');
vi.mock('../services/ai/decomposer');

import { classify } from '../services/ai/classifier';
import {
  executeGroup,
  executeMoveToPage,
  executeSortPage,
  executeRenamePage,
  executeRenameGroup,
  executeUngroup,
  executeRemove,
} from '../services/ai/executor';
import { decompose } from '../services/ai/decomposer';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_GRID = {
  pages: [
    {
      page: 1,
      title: 'Main',
      apps: [
        { id: 1, name: 'Chrome', bundle: 'com.google.Chrome' },
        { id: 2, name: 'Spotify', bundle: 'com.spotify.client' },
        { id: 3, name: 'Xcode', bundle: 'com.apple.dt.Xcode' },
      ],
      groups: [],
    },
  ],
};

const BASE_REQUEST = {
  instruction: 'group all browsers',
  grid: MINIMAL_GRID,
  currentPage: 1,
  maxItemsPerPage: 35,
  machineId: 'test-machine-001',
  licenseKey: 'TEST-LICENSE-KEY',
};

function mockClassify(overrides: object = {}) {
  vi.mocked(classify).mockResolvedValue({
    action: 'create_group',
    confidence: 0.95,
    filter: 'browsers',
    filterType: 'semantic',
    targetPage: 1,
    sourcePage: null,
    groupName: 'Browsers',
    newName: null,
    sortOrder: null,
    reason: null,
    rawPrompt: '[]',
    rawResponse: '{}',
    ...overrides,
  } as any);
}

const DET_FIELDS = { executorModel: null, rawPrompt: null, rawResponse: null };

function mockExecuteGroup(overrides: object = {}) {
  vi.mocked(executeGroup).mockResolvedValue({
    success: true,
    confidence: 0.95,
    reason: 'Found browsers',
    mutations: { groupName: 'Browsers', appIds: [1], targetPage: 1 },
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.0001,
    executorModel: 'gpt-4.1',
    rawPrompt: '[]',
    rawResponse: '{}',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('POST /api/ai/rearrange', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.PADDLE_WEBHOOK_SECRET = 'test-webhook-secret';
    process.env.PADDLE_API_KEY = 'test_paddle_api_key';
    process.env.MAILGUN_API_KEY = 'test-mailgun-key';
    process.env.MAILGUN_DOMAIN = 'test.mailgun.org';

    // Make $transaction pass through to the mock client (needed by checkAndIncrementUsage)
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock));

    // Default: usage check allowed — return a real activation under limits
    prismaMock.deviceActivation.findFirst.mockResolvedValue({
      id: 'act-1',
      licenseId: 'lic-1',
      deviceFingerprint: 'test-machine-001',
      aiDailyCount: 0,
      aiDailyResetAt: null,
      aiLifetimeCount: 0,
      license: { isTrial: false },
    } as any);
    prismaMock.deviceActivation.update.mockResolvedValue({} as any);

    // Default: decomposer returns the instruction unchanged (single-action path)
    vi.mocked(decompose).mockImplementation(async (instruction: string) => ({
      instructions: [instruction],
      inputTokens: 0,
      outputTokens: 0,
    }));

    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // -------------------------------------------------------------------------
  // Response contract — Swift depends on these fields always being present
  // -------------------------------------------------------------------------

  describe('response contract', () => {
    it('always returns id, action, success, confidence, reason, mutations', async () => {
      mockClassify();
      mockExecuteGroup();

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('action');
      expect(body).toHaveProperty('success');
      expect(body).toHaveProperty('confidence');
      expect(body).toHaveProperty('reason');
      expect(body).toHaveProperty('mutations');
    });

    it('id is a non-empty string', async () => {
      mockClassify();
      mockExecuteGroup();

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });
      const id = res.json().id;
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('success is a boolean', async () => {
      mockClassify();
      mockExecuteGroup();

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });
      expect(typeof res.json().success).toBe('boolean');
    });

    it('confidence is a number', async () => {
      mockClassify();
      mockExecuteGroup();

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });
      expect(typeof res.json().confidence).toBe('number');
    });

    it('unknown action also returns an id', async () => {
      mockClassify({ action: 'unknown', confidence: 0, reason: 'Too vague' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('id');
      expect(typeof body.id).toBe('string');
      expect(body.id.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown action
  // -------------------------------------------------------------------------

  describe('unknown action', () => {
    it('returns success=false and mutations=null without calling executor', async () => {
      mockClassify({ action: 'unknown', confidence: 0, reason: 'Too vague' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.action).toBe('unknown');
      expect(body.success).toBe(false);
      expect(body.mutations).toBeNull();
      expect(executeGroup).not.toHaveBeenCalled();
      expect(executeMoveToPage).not.toHaveBeenCalled();
    });

    it('surfaces the classifier reason to the caller', async () => {
      mockClassify({
        action: 'unknown',
        confidence: 0,
        reason: 'Please give one instruction at a time.',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });
      expect(res.json().reason).toBe('Please give one instruction at a time.');
    });
  });

  // -------------------------------------------------------------------------
  // Page bounds validation
  // -------------------------------------------------------------------------

  describe('page bounds validation', () => {
    it('rejects targetPage more than 1 beyond the current page count', async () => {
      // Grid has 1 page — page 3 is out of bounds (max allowed is 2 = pages+1)
      mockClassify({ action: 'move_to_page', targetPage: 3, filter: 'music' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.mutations).toBeNull();
      expect(body.reason).toMatch(/out of range/i);
      expect(executeMoveToPage).not.toHaveBeenCalled();
    });

    it('allows targetPage = pageCount + 1 (new page)', async () => {
      // Grid has 1 page — page 2 is valid (new page)
      mockClassify({ action: 'move_to_page', targetPage: 2, filter: 'music' });
      vi.mocked(executeMoveToPage).mockResolvedValue({
        success: true,
        confidence: 0.98,
        reason: '',
        mutations: { appIds: [2], targetPage: 2 },
        inputTokens: 50,
        outputTokens: 10,
        costUsd: 0.00001,
        ...DET_FIELDS,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(executeMoveToPage).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Routing to correct executor
  // -------------------------------------------------------------------------

  describe('executor routing', () => {
    it('routes create_group to executeGroup', async () => {
      mockClassify({ action: 'create_group' });
      mockExecuteGroup();

      await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(executeGroup).toHaveBeenCalled();
    });

    it('routes move_to_group to executeGroup', async () => {
      mockClassify({ action: 'move_to_group', groupName: 'Browsers' });
      mockExecuteGroup();

      await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(executeGroup).toHaveBeenCalled();
    });

    it('routes move_to_page to executeMoveToPage', async () => {
      mockClassify({ action: 'move_to_page', targetPage: 2 });
      vi.mocked(executeMoveToPage).mockResolvedValue({
        success: true,
        confidence: 0.95,
        reason: '',
        mutations: { appIds: [1], targetPage: 2 },
        inputTokens: 50,
        outputTokens: 10,
        costUsd: 0.00001,
        ...DET_FIELDS,
      });

      await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(executeMoveToPage).toHaveBeenCalled();
    });

    it('routes sort_page to executeSortPage', async () => {
      mockClassify({ action: 'sort_page', targetPage: 1, sortOrder: 'alphabetical' });
      vi.mocked(executeSortPage).mockResolvedValue({
        success: true,
        confidence: 1.0,
        reason: '',
        mutations: { page: 1, order: 'alphabetical' },
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        ...DET_FIELDS,
      });

      await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(executeSortPage).toHaveBeenCalled();
    });

    it('routes rename_page to executeRenamePage', async () => {
      mockClassify({ action: 'rename_page', targetPage: 1, newName: 'Work' });
      vi.mocked(executeRenamePage).mockReturnValue({
        success: true,
        confidence: 1.0,
        reason: '',
        mutations: { page: 1, newName: 'Work' },
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        ...DET_FIELDS,
      });

      await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(executeRenamePage).toHaveBeenCalled();
    });

    it('routes rename_group to executeRenameGroup', async () => {
      mockClassify({ action: 'rename_group', groupName: 'Browsers', newName: 'Web' });
      vi.mocked(executeRenameGroup).mockReturnValue({
        success: true,
        confidence: 1.0,
        reason: '',
        mutations: { currentName: 'Browsers', newName: 'Web' },
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        ...DET_FIELDS,
      });

      await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(executeRenameGroup).toHaveBeenCalled();
    });

    it('routes ungroup to executeUngroup', async () => {
      mockClassify({ action: 'ungroup', groupName: 'Browsers' });
      vi.mocked(executeUngroup).mockReturnValue({
        success: true,
        confidence: 1.0,
        reason: '',
        mutations: { groupName: 'Browsers' },
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        ...DET_FIELDS,
      });

      await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(executeUngroup).toHaveBeenCalled();
    });

    it('routes remove to executeRemove', async () => {
      mockClassify({ action: 'remove', filter: 'uninstallers' });
      vi.mocked(executeRemove).mockResolvedValue({
        success: true,
        confidence: 0.95,
        reason: '',
        mutations: { appIds: [3] },
        inputTokens: 50,
        outputTokens: 10,
        costUsd: 0.00001,
        ...DET_FIELDS,
      });

      await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(executeRemove).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  describe('input validation', () => {
    it('rejects empty instruction with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: { ...BASE_REQUEST, instruction: '' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects missing grid with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: { instruction: 'group browsers' },
      });
      expect(res.statusCode).toBe(400);
    });

    // ISSUE-11: instruction length cap
    it('rejects instruction longer than 500 characters with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: { ...BASE_REQUEST, instruction: 'a'.repeat(501) },
      });
      expect(res.statusCode).toBe(400);
    });

    it('accepts instruction exactly 500 characters', async () => {
      mockClassify();
      mockExecuteGroup();
      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: { ...BASE_REQUEST, instruction: 'a'.repeat(500) },
      });
      expect(res.statusCode).toBe(200);
    });

    // ISSUE-02: machineId / licenseKey required
    it('rejects a grid with more than 1000 total apps with 400', async () => {
      const bigPage = {
        page: 1,
        title: 'Big',
        apps: Array.from({ length: 1001 }, (_, i) => ({
          id: i + 1,
          name: `App ${i + 1}`,
          bundle: `com.app.${i + 1}`,
        })),
        groups: [],
      };
      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: { ...BASE_REQUEST, grid: { pages: [bigPage] } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/too large/i);
    });

    it('accepts a grid with exactly 1000 total apps', async () => {
      mockClassify();
      mockExecuteGroup();
      const bigPage = {
        page: 1,
        title: 'Big',
        apps: Array.from({ length: 1000 }, (_, i) => ({
          id: i + 1,
          name: `App ${i + 1}`,
          bundle: `com.app.${i + 1}`,
        })),
        groups: [],
      };
      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: { ...BASE_REQUEST, grid: { pages: [bigPage] } },
      });
      expect(res.statusCode).toBe(200);
    });

    it('counts apps inside groups toward the total', async () => {
      const pageWithGroups = {
        page: 1,
        title: 'Big',
        apps: Array.from({ length: 500 }, (_, i) => ({
          id: i + 1,
          name: `App ${i + 1}`,
          bundle: `com.app.${i + 1}`,
        })),
        groups: [
          {
            id: 1,
            name: 'Group',
            apps: Array.from({ length: 501 }, (_, i) => ({
              id: 1000 + i + 1,
              name: `GApp ${i + 1}`,
              bundle: `com.gapp.${i + 1}`,
            })),
          },
        ],
      };
      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: { ...BASE_REQUEST, grid: { pages: [pageWithGroups] } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/too large/i);
    });

    it('returns 401 when machineId is missing', async () => {
      const { machineId: _, ...withoutMachineId } = BASE_REQUEST;
      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: withoutMachineId,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when licenseKey is missing', async () => {
      const { licenseKey: _, ...withoutLicenseKey } = BASE_REQUEST;
      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: withoutLicenseKey,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Page bounds validation — extended (ISSUE-04)
  // -------------------------------------------------------------------------

  describe('page bounds validation — extended (ISSUE-04)', () => {
    it('rejects targetPage = 0', async () => {
      mockClassify({ action: 'move_to_page', targetPage: 0, sourcePage: null });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.mutations).toBeNull();
      expect(body.reason).toMatch(/out of range/i);
    });

    it('rejects negative targetPage', async () => {
      mockClassify({ action: 'move_to_page', targetPage: -1, sourcePage: null });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });

      expect(res.json().success).toBe(false);
      expect(res.json().reason).toMatch(/out of range/i);
    });

    it('rejects sourcePage = 0', async () => {
      mockClassify({ action: 'move_to_page', targetPage: 1, sourcePage: 0 });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });

      expect(res.json().success).toBe(false);
      expect(res.json().reason).toMatch(/out of range/i);
    });

    it('rejects sourcePage beyond page count', async () => {
      // MINIMAL_GRID has 1 page; sourcePage 5 is invalid
      mockClassify({ action: 'move_to_page', targetPage: 1, sourcePage: 5 });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });

      expect(res.json().success).toBe(false);
      expect(res.json().reason).toMatch(/out of range/i);
    });
  });

  // -------------------------------------------------------------------------
  // Classifier error handling
  // -------------------------------------------------------------------------

  describe('classifier error handling', () => {
    it('returns success=false when classifier throws', async () => {
      vi.mocked(classify).mockRejectedValue(new Error('OpenAI timeout'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(false);
      expect(res.json().reason).toMatch(/Classification failed/);
    });
  });

  // -------------------------------------------------------------------------
  // Executor error handling
  // -------------------------------------------------------------------------

  describe('executor error handling', () => {
    it('returns success=false when executor throws', async () => {
      mockClassify({ action: 'create_group' });
      vi.mocked(executeGroup).mockRejectedValue(new Error('OpenAI rate limit'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(false);
      expect(res.json().reason).toMatch(/Execution failed/);
    });
  });

  // -------------------------------------------------------------------------
  // Compound instructions
  // -------------------------------------------------------------------------

  describe('compound instructions', () => {
    it('executes multiple steps when decomposer returns >1 sub-instructions', async () => {
      vi.mocked(decompose).mockResolvedValue({
        instructions: ['group browsers', 'group text editors'],
        inputTokens: 10,
        outputTokens: 5,
      });

      // First call: browsers, second call: text editors
      vi.mocked(classify)
        .mockResolvedValueOnce({
          action: 'create_group',
          confidence: 0.97,
          filter: 'browsers',
          filterType: 'semantic',
          targetPage: 1,
          sourcePage: null,
          groupName: 'Browsers',
          newName: null,
          sortOrder: null,
          reason: null,
          rawPrompt: '[]',
          rawResponse: '{}',
        } as any)
        .mockResolvedValueOnce({
          action: 'create_group',
          confidence: 0.93,
          filter: 'text editors',
          filterType: 'semantic',
          targetPage: 1,
          sourcePage: null,
          groupName: 'Text Editors',
          newName: null,
          sortOrder: null,
          reason: null,
          rawPrompt: '[]',
          rawResponse: '{}',
        } as any);

      vi.mocked(executeGroup)
        .mockResolvedValueOnce({
          success: true,
          confidence: 0.97,
          reason: '',
          mutations: { groupName: 'Browsers', appIds: [1], targetPage: 1 },
          inputTokens: 50,
          outputTokens: 10,
          costUsd: 0.0001,
          executorModel: 'gpt-4.1',
          rawPrompt: '[]',
          rawResponse: '{}',
        })
        .mockResolvedValueOnce({
          success: true,
          confidence: 0.93,
          reason: '',
          mutations: { groupName: 'Text Editors', appIds: [3], targetPage: 1 },
          inputTokens: 50,
          outputTokens: 10,
          costUsd: 0.0001,
          executorModel: 'gpt-4.1',
          rawPrompt: '[]',
          rawResponse: '{}',
        });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: { ...BASE_REQUEST, instruction: 'group browsers and text editors' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.action).toBe('compound');
      expect(body.success).toBe(true);
      expect(body.confidence).toBe(0.93); // min of 0.97 and 0.93
      expect(body.mutations).toBeNull();
      expect(body.steps).toHaveLength(2);
      expect(body.steps[0].action).toBe('create_group');
      expect(body.steps[0].mutations.groupName).toBe('Browsers');
      expect(body.steps[1].action).toBe('create_group');
      expect(body.steps[1].mutations.groupName).toBe('Text Editors');
    });

    it('fails entire compound if any step classifies as unknown', async () => {
      vi.mocked(decompose).mockResolvedValue({
        instructions: ['group browsers', 'make it pretty'],
        inputTokens: 10,
        outputTokens: 5,
      });

      vi.mocked(classify)
        .mockResolvedValueOnce({
          action: 'create_group',
          confidence: 0.97,
          filter: 'browsers',
          filterType: 'semantic',
          targetPage: 1,
          sourcePage: null,
          groupName: 'Browsers',
          newName: null,
          sortOrder: null,
          reason: null,
          rawPrompt: '[]',
          rawResponse: '{}',
        } as any)
        .mockResolvedValueOnce({
          action: 'unknown',
          confidence: 0.1,
          filter: null,
          filterType: null,
          targetPage: null,
          sourcePage: null,
          groupName: null,
          newName: null,
          sortOrder: null,
          reason: 'Too vague',
          rawPrompt: '[]',
          rawResponse: '{}',
        } as any);

      vi.mocked(executeGroup).mockResolvedValueOnce({
        success: true,
        confidence: 0.97,
        reason: '',
        mutations: { groupName: 'Browsers', appIds: [1], targetPage: 1 },
        inputTokens: 50,
        outputTokens: 10,
        costUsd: 0.0001,
        executorModel: 'gpt-4.1',
        rawPrompt: '[]',
        rawResponse: '{}',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: { ...BASE_REQUEST, instruction: 'group browsers and make it pretty' },
      });

      const body = res.json();
      expect(body.action).toBe('compound');
      expect(body.success).toBe(false);
      expect(body.reason).toMatch(/make it pretty/);
      expect(body.steps).toHaveLength(1); // first step completed before failure
    });

    it('single instruction still works when decomposer returns 1 element', async () => {
      vi.mocked(decompose).mockResolvedValue({
        instructions: ['group browsers'],
        inputTokens: 10,
        outputTokens: 5,
      });
      mockClassify();
      mockExecuteGroup();

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });

      const body = res.json();
      expect(body.action).toBe('create_group'); // NOT "compound"
      expect(body.success).toBe(true);
      expect(body.mutations).toBeTruthy();
      expect(body.steps).toBeUndefined();
    });

    it('falls back to single instruction if decomposer throws', async () => {
      vi.mocked(decompose).mockRejectedValue(new Error('LLM down'));
      mockClassify();
      mockExecuteGroup();

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });

      const body = res.json();
      expect(body.action).toBe('create_group');
      expect(body.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Outcome endpoint
  // -------------------------------------------------------------------------

  describe('PATCH /api/ai/rearrange/:id/outcome', () => {
    const FAKE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    function mockPendingRecord(overrides: object = {}) {
      prismaMock.aiRequest.findUnique.mockResolvedValue({
        id: FAKE_ID,
        machineId: 'test-machine',
        licenseKey: null,
        instruction: 'group browsers',
        gridSnapshot: '{}',
        currentPage: 1,
        maxItemsPerPage: 35,
        action: 'create_group',
        confidence: 0.95,
        reason: null,
        success: true,
        mutations: null,
        classifierPrompt: null,
        classifierResponse: null,
        executorModel: null,
        executorPrompt: null,
        executorResponse: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        outcome: 'pending',
        outcomeAt: null,
        outcomeReason: null,
        createdAt: new Date(),
        durationMs: null,
        ...overrides,
      } as any);
      prismaMock.aiRequest.update.mockResolvedValue({} as any);
    }

    it('marks a pending request as accepted', async () => {
      mockPendingRecord();

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ai/rearrange/${FAKE_ID}/outcome`,
        payload: { machineId: 'test-machine', outcome: 'accepted' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('marks a pending request as undone', async () => {
      mockPendingRecord();

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ai/rearrange/${FAKE_ID}/outcome`,
        payload: { machineId: 'test-machine', outcome: 'undone' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('marks a pending request as failed_to_apply with a reason', async () => {
      mockPendingRecord();

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ai/rearrange/${FAKE_ID}/outcome`,
        payload: {
          machineId: 'test-machine',
          outcome: 'failed_to_apply',
          reason: 'Page 1 is full',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('returns 404 for an unknown id', async () => {
      prismaMock.aiRequest.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/ai/rearrange/nonexistent-id/outcome',
        payload: { machineId: 'test-machine', outcome: 'accepted' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 409 when outcome is already set', async () => {
      mockPendingRecord({ outcome: 'accepted' });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ai/rearrange/${FAKE_ID}/outcome`,
        payload: { machineId: 'test-machine', outcome: 'undone' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('returns 403 when machineId does not match', async () => {
      mockPendingRecord({ machineId: 'machine-abc' });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ai/rearrange/${FAKE_ID}/outcome`,
        payload: { machineId: 'different-machine', outcome: 'accepted' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 400 for an invalid outcome value', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ai/rearrange/${FAKE_ID}/outcome`,
        payload: { machineId: 'test-machine', outcome: 'invalid_value' },
      });

      expect(res.statusCode).toBe(400);
    });

    // ISSUE-10: records with null machineId must not be claimable by anyone
    it('returns 403 when record has null machineId (ISSUE-10)', async () => {
      mockPendingRecord({ machineId: null });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ai/rearrange/${FAKE_ID}/outcome`,
        payload: { machineId: 'any-machine', outcome: 'accepted' },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
