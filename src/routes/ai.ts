import { FastifyPluginAsync } from 'fastify';
import { openai } from '../lib/openai';
import { prisma } from '../lib/prisma';
import { classify } from '../services/ai/classifier';
import { checkAndIncrementUsage } from '../services/ai/usage';
import {
  executeMoveToPage,
  executeGroup,
  executeSortPage,
  executeRenamePage,
  executeRenameGroup,
  executeUngroup,
  executeRemove,
} from '../services/ai/executor';
import {
  RearrangeRequestSchema,
  OutcomeRequestSchema,
  VALID_OUTCOMES,
} from '../schemas/ai.schema';

const aiRoutes: FastifyPluginAsync = async (fastify) => {
  // ---------------------------------------------------------------------------
  // POST /api/ai/rearrange
  // ---------------------------------------------------------------------------
  fastify.post(
    '/ai/rearrange',
    {
      schema: {
        body: RearrangeRequestSchema,
        tags: ['ai'],
        description: 'Classify a natural-language grid instruction and return a mutation payload for Swift to apply',
      },
    },
    async (request, reply) => {
      const { instruction, grid, currentPage, maxItemsPerPage = 35, machineId, licenseKey } = request.body as any;
      const startTime = Date.now();

      // Helper: persist a row and return the id
      async function persistRequest(fields: {
        action: string;
        confidence: number;
        reason: string | null;
        success: boolean;
        mutations: unknown;
        classifierPrompt: string | null;
        classifierResponse: string | null;
        executorModel: string | null;
        executorPrompt: string | null;
        executorResponse: string | null;
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
        outcome: string;
      }): Promise<string> {
        try {
          const record = await prisma.aiRequest.create({
            data: {
              machineId: machineId ?? null,
              licenseKey: licenseKey ?? null,
              instruction,
              gridSnapshot: JSON.stringify(grid),
              currentPage: currentPage ?? null,
              maxItemsPerPage,
              action: fields.action,
              confidence: fields.confidence,
              reason: fields.reason ?? null,
              success: fields.success,
              mutations: fields.mutations != null ? JSON.stringify(fields.mutations) : null,
              classifierPrompt: fields.classifierPrompt,
              classifierResponse: fields.classifierResponse,
              executorModel: fields.executorModel,
              executorPrompt: fields.executorPrompt,
              executorResponse: fields.executorResponse,
              inputTokens: fields.inputTokens,
              outputTokens: fields.outputTokens,
              costUsd: fields.costUsd,
              outcome: fields.outcome,
              durationMs: Date.now() - startTime,
            },
          });
          return record.id;
        } catch (err) {
          // Persistence must not break the response — log and return a placeholder id
          request.log.error({ err }, 'ai persist error');
          return 'persist-failed';
        }
      }

      // ---------------------------------------------------------------------------
      // 0. Usage check
      // ---------------------------------------------------------------------------
      request.log.info({ machineId, licenseKey }, 'ai usage check');
      if (machineId && licenseKey) {
        const usage = await checkAndIncrementUsage(licenseKey, machineId);
        if (!usage.allowed) {
          // Persist as not_applicable (rate limited — never reached the LLM)
          const id = await persistRequest({
            action: 'rate_limited',
            confidence: 1,
            reason: usage.reason ?? 'Usage limit reached',
            success: false,
            mutations: null,
            classifierPrompt: null,
            classifierResponse: null,
            executorModel: null,
            executorPrompt: null,
            executorResponse: null,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            outcome: 'not_applicable',
          });
          return reply.status(429).send({
            id,
            error: 'AI usage limit reached',
            reason: usage.reason,
            limitType: usage.limitType,
          });
        }
      }

      // ---------------------------------------------------------------------------
      // 1. Classify intent
      // ---------------------------------------------------------------------------
      let classified;
      try {
        classified = await classify(instruction, openai, {
          pageCount: grid.pages.length,
          currentPage,
        });
      } catch (err) {
        request.log.error({ err, instruction }, 'ai classify error');
        return reply.status(502).send({ error: 'Classification failed', detail: String(err) });
      }

      request.log.info(
        { action: classified.action, confidence: classified.confidence, filter: classified.filter, filterType: classified.filterType, targetPage: classified.targetPage, sourcePage: classified.sourcePage, groupName: classified.groupName, instruction },
        'ai classify'
      );

      // ---------------------------------------------------------------------------
      // 2. Unknown / unsupported instruction — return early
      // ---------------------------------------------------------------------------
      if (classified.action === 'unknown') {
        const id = await persistRequest({
          action: 'unknown',
          confidence: classified.confidence,
          reason: classified.reason,
          success: false,
          mutations: null,
          classifierPrompt: classified.rawPrompt,
          classifierResponse: classified.rawResponse,
          executorModel: null,
          executorPrompt: null,
          executorResponse: null,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          outcome: 'not_applicable',
        });
        return reply.send({
          id,
          action: 'unknown',
          success: false,
          confidence: classified.confidence,
          reason: classified.reason ?? 'Instruction not understood',
          mutations: null,
        });
      }

      // ---------------------------------------------------------------------------
      // 3. Validate classifier output
      // ---------------------------------------------------------------------------
      if (
        classified.targetPage !== null &&
        classified.targetPage > grid.pages.length + 1
      ) {
        const id = await persistRequest({
          action: classified.action,
          confidence: classified.confidence,
          reason: `Page ${classified.targetPage} doesn't exist. The grid has ${grid.pages.length} page(s).`,
          success: false,
          mutations: null,
          classifierPrompt: classified.rawPrompt,
          classifierResponse: classified.rawResponse,
          executorModel: null,
          executorPrompt: null,
          executorResponse: null,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          outcome: 'not_applicable',
        });
        return reply.send({
          id,
          action: classified.action,
          success: false,
          confidence: classified.confidence,
          reason: `Page ${classified.targetPage} doesn't exist. The grid has ${grid.pages.length} page(s).`,
          mutations: null,
        });
      }

      // ---------------------------------------------------------------------------
      // 4. Route to executor
      // ---------------------------------------------------------------------------

      // Auto-select executor model based on filter complexity (mirrors pipeline.py)
      const executorModel = classified.filterType === 'semantic' ? 'gpt-4.1' : 'gpt-4.1-mini';

      let result;
      try {
        switch (classified.action) {
          case 'move_to_page':
            result = await executeMoveToPage(classified, grid, openai, executorModel, maxItemsPerPage, currentPage);
            break;

          case 'create_group':
          case 'move_to_group':
            result = await executeGroup(classified, grid, openai, executorModel, currentPage);
            break;

          case 'sort_page':
            result = await executeSortPage(classified, grid, openai, executorModel);
            break;

          case 'rename_page':
            result = executeRenamePage(classified, grid);
            break;

          case 'rename_group':
            result = executeRenameGroup(classified, grid);
            break;

          case 'ungroup':
            result = executeUngroup(classified, grid);
            break;

          case 'remove':
            result = await executeRemove(classified, grid, openai, executorModel);
            break;

          default:
            return reply.send({
              id: 'unhandled',
              action: classified.action,
              success: false,
              confidence: 0,
              reason: 'Unhandled action type',
              mutations: null,
            });
        }
      } catch (err) {
        request.log.error({ err, action: classified.action, instruction }, 'ai executor error');
        return reply.status(502).send({ error: 'Execution failed', detail: String(err) });
      }

      request.log.info(
        {
          action: classified.action,
          success: result.success,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
        },
        'ai execute'
      );

      // Persist — for successful backend executions the outcome starts as "pending"
      // (waiting for client to report accepted/undone/failed_to_apply).
      // For backend failures, it's "not_applicable".
      const outcome = result.success ? 'pending' : 'not_applicable';
      const id = await persistRequest({
        action: classified.action,
        confidence: result.confidence,
        reason: result.reason || null,
        success: result.success,
        mutations: result.mutations,
        classifierPrompt: classified.rawPrompt,
        classifierResponse: classified.rawResponse,
        executorModel: result.executorModel,
        executorPrompt: result.rawPrompt,
        executorResponse: result.rawResponse,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        outcome,
      });

      return reply.send({
        id,
        action: classified.action,
        success: result.success,
        confidence: result.confidence,
        reason: result.reason,
        mutations: result.mutations,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/ai/rearrange/:id/outcome
  // ---------------------------------------------------------------------------
  fastify.patch(
    '/ai/rearrange/:id/outcome',
    {
      schema: {
        body: OutcomeRequestSchema,
        tags: ['ai'],
        description: 'Report the user outcome (accepted / undone / failed_to_apply) for an AI request',
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { machineId, outcome, reason } = request.body as any;

      if (!VALID_OUTCOMES.includes(outcome)) {
        return reply.status(400).send({ error: `Invalid outcome. Must be one of: ${VALID_OUTCOMES.join(', ')}` });
      }

      let record;
      try {
        record = await prisma.aiRequest.findUnique({ where: { id } });
      } catch (err) {
        request.log.error({ err, id }, 'ai outcome lookup error');
        return reply.status(500).send({ error: 'Internal error' });
      }

      if (!record) {
        return reply.status(404).send({ error: 'AI request not found' });
      }

      if (record.machineId && record.machineId !== machineId) {
        return reply.status(403).send({ error: 'Machine ID mismatch' });
      }

      if (record.outcome !== 'pending') {
        return reply.status(409).send({ error: `Outcome already set to '${record.outcome}'` });
      }

      try {
        await prisma.aiRequest.update({
          where: { id },
          data: {
            outcome,
            outcomeAt: new Date(),
            outcomeReason: outcome === 'failed_to_apply' ? (reason ?? null) : null,
          },
        });
      } catch (err) {
        request.log.error({ err, id, outcome }, 'ai outcome update error');
        return reply.status(500).send({ error: 'Internal error' });
      }

      request.log.info({ id, outcome }, 'ai outcome recorded');
      return reply.send({ success: true });
    }
  );
};

export default aiRoutes;
