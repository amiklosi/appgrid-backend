import { FastifyPluginAsync } from 'fastify';
import { openai } from '../lib/openai';
import { prisma } from '../lib/prisma';
import { classify, ClassifiedAction } from '../services/ai/classifier';
import { checkAndIncrementUsage } from '../services/ai/usage';
import {
  executeMoveToPage,
  executeGroup,
  executeSortPage,
  executeRenamePage,
  executeRenameGroup,
  executeUngroup,
  executeRemove,
  ExecutorResult,
} from '../services/ai/executor';
import { decompose } from '../services/ai/decomposer';
import {
  RearrangeRequestSchema,
  OutcomeRequestSchema,
  VALID_OUTCOMES,
  StepResult,
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
        description:
          'Classify a natural-language grid instruction and return a mutation payload for Swift to apply',
      },
    },
    async (request, reply) => {
      const {
        instruction,
        grid,
        currentPage,
        maxItemsPerPage = 35,
        machineId,
        licenseKey,
      } = request.body as any;
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
      // 0. Require both machineId and licenseKey — no anonymous AI calls
      // ---------------------------------------------------------------------------
      if (!machineId || !licenseKey) {
        return reply.status(401).send({ error: 'machineId and licenseKey are required' });
      }

      // ---------------------------------------------------------------------------
      // 0b. Grid size guard — reject oversized grids before hitting the LLM
      // ---------------------------------------------------------------------------
      const MAX_GRID_APPS = 1000;
      const totalApps = grid.pages.reduce(
        (sum: number, p: any) =>
          sum +
          (p.apps?.length ?? 0) +
          (p.groups ?? []).reduce((gs: number, g: any) => gs + (g.apps?.length ?? 0), 0),
        0
      );
      if (totalApps > MAX_GRID_APPS) {
        return reply.status(400).send({
          error: `Grid too large: ${totalApps} apps exceeds the maximum of ${MAX_GRID_APPS}`,
        });
      }

      // ---------------------------------------------------------------------------
      // 0c. Usage check
      // ---------------------------------------------------------------------------
      request.log.info({ machineId, licenseKey }, 'ai usage check');
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

      // ---------------------------------------------------------------------------
      // Helper: classify → validate → execute a single sub-instruction
      // ---------------------------------------------------------------------------
      async function classifyAndExecute(
        subInstruction: string
      ): Promise<
        | { ok: true; classified: ClassifiedAction; result: ExecutorResult }
        | { ok: false; classified: ClassifiedAction | null; reason: string }
      > {
        let classified: ClassifiedAction;
        try {
          classified = await classify(subInstruction, openai, {
            pageCount: grid.pages.length,
            currentPage,
          });
        } catch (err) {
          return { ok: false, classified: null, reason: `Classification failed: ${err}` };
        }

        if (classified.action === 'unknown') {
          return {
            ok: false,
            classified,
            reason: classified.reason ?? 'Instruction not understood',
          };
        }

        // Validate page numbers
        const maxPageNum =
          grid.pages.length > 0 ? Math.max(...grid.pages.map((p: { page: number }) => p.page)) : 0;
        const targetPageInvalid =
          classified.targetPage !== null &&
          (classified.targetPage < 1 || classified.targetPage > maxPageNum + 1);
        const sourcePageInvalid =
          classified.sourcePage !== null &&
          (classified.sourcePage < 1 || classified.sourcePage > maxPageNum);
        if (targetPageInvalid || sourcePageInvalid) {
          const badPage = targetPageInvalid ? classified.targetPage : classified.sourcePage;
          return {
            ok: false,
            classified,
            reason: `Page ${badPage} is out of range. The grid has ${grid.pages.length} page(s).`,
          };
        }

        // Execute
        const executorModel = classified.filterType === 'semantic' ? 'gpt-4.1' : 'gpt-4.1-mini';
        let result: ExecutorResult;
        try {
          switch (classified.action) {
            case 'move_to_page':
              result = await executeMoveToPage(
                classified,
                grid,
                openai,
                executorModel,
                maxItemsPerPage,
                currentPage
              );
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
              return { ok: false, classified, reason: 'Unhandled action type' };
          }
        } catch (err) {
          return { ok: false, classified, reason: `Execution failed: ${err}` };
        }

        return { ok: true, classified, result };
      }

      // ---------------------------------------------------------------------------
      // 1. Decompose instruction into sub-instructions
      // ---------------------------------------------------------------------------
      let subInstructions: string[];
      let decomposerTokens = { inputTokens: 0, outputTokens: 0 };
      try {
        const decomposed = await decompose(instruction, openai);
        subInstructions = decomposed.instructions;
        decomposerTokens = {
          inputTokens: decomposed.inputTokens,
          outputTokens: decomposed.outputTokens,
        };
      } catch (err) {
        request.log.error({ err, instruction }, 'ai decompose error');
        // Fall back to treating the whole instruction as a single action
        subInstructions = [instruction];
      }

      request.log.info({ subInstructions, count: subInstructions.length }, 'ai decompose');

      // ---------------------------------------------------------------------------
      // 2. Single instruction — original path (no behavior change)
      // ---------------------------------------------------------------------------
      if (subInstructions.length === 1) {
        const outcome = await classifyAndExecute(subInstructions[0]);

        if (!outcome.ok) {
          const classified = outcome.classified;
          const id = await persistRequest({
            action: classified?.action ?? 'unknown',
            confidence: classified?.confidence ?? 0,
            reason: outcome.reason,
            success: false,
            mutations: null,
            classifierPrompt: classified?.rawPrompt ?? null,
            classifierResponse: classified?.rawResponse ?? null,
            executorModel: null,
            executorPrompt: null,
            executorResponse: null,
            inputTokens: decomposerTokens.inputTokens,
            outputTokens: decomposerTokens.outputTokens,
            costUsd: 0,
            outcome: 'not_applicable',
          });
          return reply.send({
            id,
            action: classified?.action ?? 'unknown',
            success: false,
            confidence: classified?.confidence ?? 0,
            reason: outcome.reason,
            mutations: null,
          });
        }

        const { classified, result } = outcome;

        request.log.info(
          {
            action: classified.action,
            success: result.success,
            inputTokens: result.inputTokens + decomposerTokens.inputTokens,
            outputTokens: result.outputTokens + decomposerTokens.outputTokens,
            costUsd: result.costUsd,
          },
          'ai execute'
        );

        const persistOutcome = result.success ? 'pending' : 'not_applicable';
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
          inputTokens: result.inputTokens + decomposerTokens.inputTokens,
          outputTokens: result.outputTokens + decomposerTokens.outputTokens,
          costUsd: result.costUsd,
          outcome: persistOutcome,
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

      // ---------------------------------------------------------------------------
      // 3. Compound instruction — execute each sub-instruction sequentially
      // ---------------------------------------------------------------------------
      const steps: StepResult[] = [];
      let totalInputTokens = decomposerTokens.inputTokens;
      let totalOutputTokens = decomposerTokens.outputTokens;
      let totalCost = 0;
      let allClassifierPrompts: string[] = [];
      let allClassifierResponses: string[] = [];
      let allExecutorPrompts: string[] = [];
      let allExecutorResponses: string[] = [];
      let minConfidence = 1;

      for (const sub of subInstructions) {
        const outcome = await classifyAndExecute(sub);

        if (!outcome.ok) {
          // One step failed — fail the entire compound request
          const reason = `Step "${sub}" failed: ${outcome.reason}`;
          request.log.warn({ sub, reason }, 'ai compound step failed');

          const id = await persistRequest({
            action: 'compound',
            confidence: 0,
            reason,
            success: false,
            mutations: steps, // persist partial steps for debugging
            classifierPrompt: allClassifierPrompts.join('\n---\n') || null,
            classifierResponse: allClassifierResponses.join('\n---\n') || null,
            executorModel: null,
            executorPrompt: allExecutorPrompts.join('\n---\n') || null,
            executorResponse: allExecutorResponses.join('\n---\n') || null,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            costUsd: totalCost,
            outcome: 'not_applicable',
          });

          return reply.send({
            id,
            action: 'compound',
            success: false,
            confidence: 0,
            reason,
            mutations: null,
            steps,
          });
        }

        const { classified, result } = outcome;

        totalInputTokens += result.inputTokens;
        totalOutputTokens += result.outputTokens;
        totalCost += result.costUsd;
        minConfidence = Math.min(minConfidence, result.confidence);
        if (classified.rawPrompt) allClassifierPrompts.push(classified.rawPrompt);
        if (classified.rawResponse) allClassifierResponses.push(classified.rawResponse);
        if (result.rawPrompt) allExecutorPrompts.push(result.rawPrompt);
        if (result.rawResponse) allExecutorResponses.push(result.rawResponse);

        steps.push({
          action: classified.action,
          success: result.success,
          confidence: result.confidence,
          reason: result.reason || null,
          mutations: result.mutations,
        });

        request.log.info(
          { sub, action: classified.action, success: result.success },
          'ai compound step'
        );
      }

      const allSucceeded = steps.every((s) => s.success);
      const persistOutcome = allSucceeded ? 'pending' : 'not_applicable';

      const id = await persistRequest({
        action: 'compound',
        confidence: minConfidence,
        reason: null,
        success: allSucceeded,
        mutations: steps,
        classifierPrompt: allClassifierPrompts.join('\n---\n') || null,
        classifierResponse: allClassifierResponses.join('\n---\n') || null,
        executorModel: null,
        executorPrompt: allExecutorPrompts.join('\n---\n') || null,
        executorResponse: allExecutorResponses.join('\n---\n') || null,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: totalCost,
        outcome: persistOutcome,
      });

      request.log.info(
        {
          stepCount: steps.length,
          allSucceeded,
          totalInputTokens,
          totalOutputTokens,
          totalCost,
        },
        'ai compound complete'
      );

      return reply.send({
        id,
        action: 'compound',
        success: allSucceeded,
        confidence: minConfidence,
        reason: null,
        mutations: null,
        steps,
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
        description:
          'Report the user outcome (accepted / undone / failed_to_apply) for an AI request',
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { machineId, outcome, reason } = request.body as any;

      if (!VALID_OUTCOMES.includes(outcome)) {
        return reply
          .status(400)
          .send({ error: `Invalid outcome. Must be one of: ${VALID_OUTCOMES.join(', ')}` });
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

      if (!record.machineId || record.machineId !== machineId) {
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
