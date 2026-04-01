/**
 * ai.routes.test.ts
 *
 * Integration tests for POST /api/ai/rearrange.
 * Both the classifier and executor are mocked — no real OpenAI calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index';

// ---------------------------------------------------------------------------
// Mock the OpenAI singleton so no real network calls are made
// ---------------------------------------------------------------------------
vi.mock('../lib/openai', () => ({ openai: {} }));

// ---------------------------------------------------------------------------
// Mock classifier and executor modules
// ---------------------------------------------------------------------------
vi.mock('../services/ai/classifier');
vi.mock('../services/ai/executor');

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
    ...overrides,
  } as any);
}

function mockExecuteGroup(overrides: object = {}) {
  vi.mocked(executeGroup).mockResolvedValue({
    success: true,
    confidence: 0.95,
    reason: 'Found browsers',
    mutations: { groupName: 'Browsers', appIds: [1], targetPage: 1 },
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.0001,
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
    it('always returns action, success, confidence, reason, mutations', async () => {
      mockClassify();
      mockExecuteGroup();

      const res = await app.inject({
        method: 'POST',
        url: '/api/ai/rearrange',
        payload: BASE_REQUEST,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('action');
      expect(body).toHaveProperty('success');
      expect(body).toHaveProperty('confidence');
      expect(body).toHaveProperty('reason');
      expect(body).toHaveProperty('mutations');
    });

    it('success is a boolean', async () => {
      mockClassify();
      mockExecuteGroup();

      const res = await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(typeof res.json().success).toBe('boolean');
    });

    it('confidence is a number', async () => {
      mockClassify();
      mockExecuteGroup();

      const res = await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(typeof res.json().confidence).toBe('number');
    });
  });

  // -------------------------------------------------------------------------
  // Unknown action
  // -------------------------------------------------------------------------

  describe('unknown action', () => {
    it('returns success=false and mutations=null without calling executor', async () => {
      mockClassify({ action: 'unknown', confidence: 0, reason: 'Too vague' });

      const res = await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.action).toBe('unknown');
      expect(body.success).toBe(false);
      expect(body.mutations).toBeNull();
      expect(executeGroup).not.toHaveBeenCalled();
      expect(executeMoveToPage).not.toHaveBeenCalled();
    });

    it('surfaces the classifier reason to the caller', async () => {
      mockClassify({ action: 'unknown', confidence: 0, reason: 'Please give one instruction at a time.' });

      const res = await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
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

      const res = await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.mutations).toBeNull();
      expect(body.reason).toMatch(/doesn't exist/i);
      expect(executeMoveToPage).not.toHaveBeenCalled();
    });

    it('allows targetPage = pageCount + 1 (new page)', async () => {
      // Grid has 1 page — page 2 is valid (new page)
      mockClassify({ action: 'move_to_page', targetPage: 2, filter: 'music' });
      vi.mocked(executeMoveToPage).mockResolvedValue({
        success: true, confidence: 0.98, reason: '', mutations: { appIds: [2], targetPage: 2 },
        inputTokens: 50, outputTokens: 10, costUsd: 0.00001,
      });

      const res = await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });

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
        success: true, confidence: 0.95, reason: '', mutations: { appIds: [1], targetPage: 2 },
        inputTokens: 50, outputTokens: 10, costUsd: 0.00001,
      });

      await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(executeMoveToPage).toHaveBeenCalled();
    });

    it('routes sort_page to executeSortPage', async () => {
      mockClassify({ action: 'sort_page', targetPage: 1, sortOrder: 'alphabetical' });
      vi.mocked(executeSortPage).mockResolvedValue({
        success: true, confidence: 1.0, reason: '', mutations: { page: 1, order: 'alphabetical' },
        inputTokens: 0, outputTokens: 0, costUsd: 0,
      });

      await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(executeSortPage).toHaveBeenCalled();
    });

    it('routes rename_page to executeRenamePage', async () => {
      mockClassify({ action: 'rename_page', targetPage: 1, newName: 'Work' });
      vi.mocked(executeRenamePage).mockReturnValue({
        success: true, confidence: 1.0, reason: '', mutations: { page: 1, newName: 'Work' },
        inputTokens: 0, outputTokens: 0, costUsd: 0,
      });

      await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(executeRenamePage).toHaveBeenCalled();
    });

    it('routes rename_group to executeRenameGroup', async () => {
      mockClassify({ action: 'rename_group', groupName: 'Browsers', newName: 'Web' });
      vi.mocked(executeRenameGroup).mockReturnValue({
        success: true, confidence: 1.0, reason: '', mutations: { currentName: 'Browsers', newName: 'Web' },
        inputTokens: 0, outputTokens: 0, costUsd: 0,
      });

      await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(executeRenameGroup).toHaveBeenCalled();
    });

    it('routes ungroup to executeUngroup', async () => {
      mockClassify({ action: 'ungroup', groupName: 'Browsers' });
      vi.mocked(executeUngroup).mockReturnValue({
        success: true, confidence: 1.0, reason: '', mutations: { groupName: 'Browsers' },
        inputTokens: 0, outputTokens: 0, costUsd: 0,
      });

      await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(executeUngroup).toHaveBeenCalled();
    });

    it('routes remove to executeRemove', async () => {
      mockClassify({ action: 'remove', filter: 'uninstallers' });
      vi.mocked(executeRemove).mockResolvedValue({
        success: true, confidence: 0.95, reason: '', mutations: { appIds: [3] },
        inputTokens: 50, outputTokens: 10, costUsd: 0.00001,
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
  });

  // -------------------------------------------------------------------------
  // Classifier error handling
  // -------------------------------------------------------------------------

  describe('classifier error handling', () => {
    it('returns 502 when classifier throws', async () => {
      vi.mocked(classify).mockRejectedValue(new Error('OpenAI timeout'));

      const res = await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(res.statusCode).toBe(502);
    });
  });

  // -------------------------------------------------------------------------
  // Executor error handling
  // -------------------------------------------------------------------------

  describe('executor error handling', () => {
    it('returns 502 when executor throws', async () => {
      mockClassify({ action: 'create_group' });
      vi.mocked(executeGroup).mockRejectedValue(new Error('OpenAI rate limit'));

      const res = await app.inject({ method: 'POST', url: '/api/ai/rearrange', payload: BASE_REQUEST });
      expect(res.statusCode).toBe(502);
    });
  });
});
