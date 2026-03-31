import { FastifyPluginAsync } from 'fastify';
import { openai } from '../lib/openai';
import { classify } from '../services/ai/classifier';
import {
  executeMoveToPage,
  executeGroup,
  executeSortPage,
  executeRenamePage,
  executeRenameGroup,
  executeRemove,
} from '../services/ai/executor';
import { RearrangeRequestSchema } from '../schemas/ai.schema';

const aiRoutes: FastifyPluginAsync = async (fastify) => {
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
      const { instruction, grid, currentPage, maxItemsPerPage = 35 } = request.body as any;

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
        { action: classified.action, confidence: classified.confidence, instruction },
        'ai classify'
      );

      // ---------------------------------------------------------------------------
      // 2. Unknown / unsupported instruction — return early
      // ---------------------------------------------------------------------------
      if (classified.action === 'unknown') {
        return reply.send({
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
        return reply.send({
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

          case 'remove':
            result = await executeRemove(classified, grid, openai, executorModel);
            break;

          default:
            return reply.send({
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

      return reply.send({
        action: classified.action,
        success: result.success,
        confidence: result.confidence,
        reason: result.reason,
        mutations: result.mutations,
      });
    }
  );
};

export default aiRoutes;
