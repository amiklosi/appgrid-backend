/**
 * executor.ts
 * One function per action type. Makes LLM calls where needed, returns a typed
 * mutation payload. Does NOT touch any tree or database — that is Swift's job.
 * Ported from actions.py (LLM call portions only).
 */

import OpenAI from 'openai';
import { ClassifiedAction } from './classifier';
import {
  Grid,
  AnyMutations,
  MoveToPageMutations,
  GroupMutations,
  SortPageMutations,
  RenamePageMutations,
  RenameGroupMutations,
  RemoveMutations,
  UngroupMutations,
} from '../../schemas/ai.schema';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ExecutorResult {
  success: boolean;
  confidence: number;
  reason: string;
  mutations: AnyMutations | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  // Raw LLM data for persistence (null for deterministic executors)
  executorModel: string | null;
  rawPrompt: string | null;
  rawResponse: string | null;
}

// ---------------------------------------------------------------------------
// Model costs (per 1M tokens, USD)
// ---------------------------------------------------------------------------

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
};

function calcCost(model: string, inTok: number, outTok: number): number {
  const c = MODEL_COSTS[model] ?? { input: 0, output: 0 };
  return (inTok * c.input + outTok * c.output) / 1_000_000;
}

function extractJson(text: string): Record<string, unknown> {
  text = text
    .replace(/```(?:json)?\s*/g, '')
    .replace(/```/g, '')
    .trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) {
    throw new Error(`No JSON in executor response: ${text.slice(0, 200)}`);
  }
  // Strip JS-style line comments (// ...) before parsing — LLMs occasionally emit them.
  // Note: executor calls use response_format json_object which prevents this, but we keep
  // the strip as a safety net for any legacy/fallback responses.
  const json = text.slice(start, end).replace(/\/\/[^\n]*/g, '');
  return JSON.parse(json);
}

// ---------------------------------------------------------------------------
// Helpers to build deterministic (no-LLM) results
// ---------------------------------------------------------------------------

function det(
  success: boolean,
  confidence: number,
  reason: string,
  mutations: AnyMutations | null
): ExecutorResult {
  return {
    success,
    confidence,
    reason,
    mutations,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    executorModel: null,
    rawPrompt: null,
    rawResponse: null,
  };
}

// ---------------------------------------------------------------------------
// Grid serialisation helpers (mirrors grid_model.py)
// ---------------------------------------------------------------------------

/**
 * Full paged grid for move_to_page prompts.
 * Apps inside groups are flattened onto their page with a "group" annotation.
 */
function toJsonIds(grid: Grid): string {
  const pages = grid.pages.map((p) => {
    const apps: object[] = [
      ...p.apps.map((a) => ({ id: a.id, name: a.name, bundle: a.bundle })),
      ...(p.groups ?? []).flatMap((g) =>
        g.apps.map((a) => ({ id: a.id, name: a.name, bundle: a.bundle, group: g.name }))
      ),
    ];
    return { page: p.page, apps };
  });
  return JSON.stringify({ pages });
}

/**
 * Flat app list for group/remove prompts.
 * includeBundle=true for semantic filters (browsers, music, etc.)
 */
function allAppsJson(grid: Grid, includeBundle: boolean): string {
  const apps: object[] = [];
  for (const page of grid.pages) {
    for (const a of page.apps) {
      apps.push(
        includeBundle ? { id: a.id, name: a.name, bundle: a.bundle } : { id: a.id, name: a.name }
      );
    }
    for (const g of page.groups ?? []) {
      for (const a of g.apps) {
        apps.push(
          includeBundle ? { id: a.id, name: a.name, bundle: a.bundle } : { id: a.id, name: a.name }
        );
      }
    }
  }
  return JSON.stringify(apps);
}

/** All app IDs present in the grid. */
function allAppIds(grid: Grid): Set<number> {
  const ids = new Set<number>();
  for (const page of grid.pages) {
    page.apps.forEach((a) => ids.add(a.id));
    (page.groups ?? []).forEach((g) => g.apps.forEach((a) => ids.add(a.id)));
  }
  return ids;
}

// ---------------------------------------------------------------------------
// move_to_page
// ---------------------------------------------------------------------------

const MOVE_TO_PAGE_PROMPT = `\
You are an app grid organizer. You will receive a grid as JSON and an instruction.
Return only the moves needed.

INPUT: {"pages":[{"page":N,"apps":[{"id":X,"name":"...","bundle":"..."}]}]}

RULES:
1. Identify apps matching the filter using name and bundle knowledge.
2. For each match, record a move to the target page.
3. Apps already on the target page: include them anyway (no-op moves are fine).
4. Apps NOT matching: do not include.
5. Set success=false if the instruction can't be fully carried out.

RESPONSE — JSON only:
{"moves":[{"id":X,"name":"...","to_page":N}],
  "success":true,"confidence":0.95,"reason":""}`;

export async function executeMoveToPage(
  ca: ClassifiedAction,
  grid: Grid,
  client: OpenAI,
  model: string,
  maxItemsPerPage: number = 35,
  currentPage?: number
): Promise<ExecutorResult> {
  // source_page set with no filter → deterministic, move all apps on that page
  if (ca.sourcePage !== null && !ca.filter) {
    if (ca.targetPage == null) {
      return det(false, 1.0, 'No target page specified', null);
    }
    const sourcePage = grid.pages.find((p) => p.page === ca.sourcePage);
    if (!sourcePage) {
      return det(false, 1.0, `Page ${ca.sourcePage} not found`, null);
    }
    const appIds = [
      ...sourcePage.apps.map((a) => a.id),
      ...(sourcePage.groups ?? []).flatMap((g) => g.apps.map((a) => a.id)),
    ];
    const mutations: MoveToPageMutations = { appIds, targetPage: ca.targetPage };
    return det(true, 1.0, '', mutations);
  }

  if (ca.targetPage == null) {
    return det(false, 1.0, 'No target page specified', null);
  }

  const gridRepr = toJsonIds(grid);
  const userMsg =
    `Grid:\n${gridRepr}\n\n` +
    (currentPage !== undefined ? `User is currently on page ${currentPage}.\n` : '') +
    `Instruction: Move ${ca.filter ?? 'matching apps'} to page ${ca.targetPage}.\n` +
    `Max ${maxItemsPerPage} apps per page.`;

  const messages = [
    { role: 'system' as const, content: MOVE_TO_PAGE_PROMPT },
    { role: 'user' as const, content: userMsg },
  ];

  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  const raw = resp.choices[0].message.content ?? '';
  const inTok = resp.usage?.prompt_tokens ?? 0;
  const outTok = resp.usage?.completion_tokens ?? 0;

  const data = extractJson(raw);
  const success = Boolean(data.success ?? true);
  const confidence = Number(data.confidence ?? 1.0);
  const reason = String(data.reason ?? '');
  const moves = (data.moves as Array<{ id: number; to_page: number }>) ?? [];

  const validIds = allAppIds(grid);
  const appIds = moves
    .filter((m) => m.id != null && validIds.has(Number(m.id)))
    .map((m) => Number(m.id));

  const mutations: MoveToPageMutations = { appIds, targetPage: ca.targetPage };

  return {
    success,
    confidence,
    reason,
    mutations,
    inputTokens: inTok,
    outputTokens: outTok,
    costUsd: calcCost(model, inTok, outTok),
    executorModel: model,
    rawPrompt: JSON.stringify(messages),
    rawResponse: raw,
  };
}

// ---------------------------------------------------------------------------
// create_group / move_to_group
// ---------------------------------------------------------------------------

const GROUP_PROMPT = `\
You are an app grid organizer. Given a list of apps and an instruction, \
identify which apps belong in the named group.

INPUT: [{"id":X,"name":"..."}]

RULES:
1. Match apps by their displayed NAME and bundle ID knowledge.
2. List matching app IDs in "apps". Do not include non-matching apps.
3. Set success=false if you can't identify any matching apps.

RESPONSE — JSON only:
{"name":"<group name>","apps":[id,id,...],
  "success":true,"confidence":0.95,"reason":""}`;

export async function executeGroup(
  ca: ClassifiedAction,
  grid: Grid,
  client: OpenAI,
  model: string,
  currentPage?: number
): Promise<ExecutorResult> {
  const groupName = ca.groupName ?? null;
  const resolvedGroupName = groupName ?? 'New Group';
  const targetPage = ca.targetPage ?? ca.sourcePage ?? currentPage ?? 1;
  const semantic = ca.filterType === 'semantic';

  // Validate targetPage exists in the grid (ISSUE-08)
  if (!grid.pages.find((p) => p.page === targetPage)) {
    return det(false, 1.0, `Target page ${targetPage} not found in grid`, null);
  }

  // source_page + no filter → deterministic
  if (ca.sourcePage !== null && !ca.filter) {
    const sourcePage = grid.pages.find((p) => p.page === ca.sourcePage);
    if (!sourcePage) {
      return det(false, 1.0, `Page ${ca.sourcePage} not found`, null);
    }
    const appIds = [
      ...sourcePage.apps.map((a) => a.id),
      ...(sourcePage.groups ?? []).flatMap((g) => g.apps.map((a) => a.id)),
    ];
    const mutations: GroupMutations = { groupName: resolvedGroupName, appIds, targetPage };
    return det(true, 1.0, '', mutations);
  }

  // Build candidate pool
  let candidateApps: Array<{ id: number; name: string; bundle: string }>;
  if (ca.sourcePage !== null) {
    const sourcePage = grid.pages.find((p) => p.page === ca.sourcePage);
    if (!sourcePage) {
      return det(false, 1.0, `Page ${ca.sourcePage} not found`, null);
    }
    candidateApps = [...sourcePage.apps, ...(sourcePage.groups ?? []).flatMap((g) => g.apps)];
  } else {
    candidateApps = [];
    for (const page of grid.pages) {
      candidateApps.push(...page.apps);
      (page.groups ?? []).forEach((g) => candidateApps.push(...g.apps));
    }
  }

  const appsRepr = JSON.stringify(
    candidateApps.map((a) =>
      semantic ? { id: a.id, name: a.name, bundle: a.bundle } : { id: a.id, name: a.name }
    )
  );
  const userMsg =
    `Apps:\n${appsRepr}\n\n` +
    (currentPage !== undefined ? `User is currently on page ${currentPage}.\n` : '') +
    `Instruction: ${ca.filter ?? 'matching apps'} should go into a group` +
    (groupName ? ` named '${groupName}'` : ` (infer a concise title-cased name from the filter)`) +
    `.`;

  const messages = [
    { role: 'system' as const, content: GROUP_PROMPT },
    { role: 'user' as const, content: userMsg },
  ];

  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  const raw = resp.choices[0].message.content ?? '';
  const inTok = resp.usage?.prompt_tokens ?? 0;
  const outTok = resp.usage?.completion_tokens ?? 0;

  const data = extractJson(raw);
  const success = Boolean(data.success ?? true);
  const confidence = Number(data.confidence ?? 1.0);
  const reason = String(data.reason ?? '');
  const name =
    String(data.name || groupName || 'New Group')
      .trim()
      .slice(0, 64) || 'New Group';

  const validCandidateIds = new Set(candidateApps.map((a) => a.id));
  const appIds = ((data.apps as unknown[]) ?? [])
    .map((id) => Number(id))
    .filter((id) => !isNaN(id) && validCandidateIds.has(id));

  if (appIds.length === 0) {
    return {
      success: false,
      confidence,
      reason: reason || 'No matching apps found',
      mutations: null,
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd: calcCost(model, inTok, outTok),
      executorModel: model,
      rawPrompt: JSON.stringify(messages),
      rawResponse: raw,
    };
  }

  const mutations: GroupMutations = { groupName: name, appIds, targetPage };
  return {
    success,
    confidence,
    reason,
    mutations,
    inputTokens: inTok,
    outputTokens: outTok,
    costUsd: calcCost(model, inTok, outTok),
    executorModel: model,
    rawPrompt: JSON.stringify(messages),
    rawResponse: raw,
  };
}

// ---------------------------------------------------------------------------
// sort_page
// ---------------------------------------------------------------------------

const SORT_PROMPT = `\
You are an app grid organizer. Re-order the apps on the given page.

INPUT: {"page":N,"apps":[{"id":X,"name":"...","bundle":"..."}]}

RULES:
1. Apply the requested sort order to produce a new ordering of the same apps.
2. Return ALL app IDs — no additions or removals.
3. sort_order values: "alphabetical" (A→Z by name), "reverse_alphabetical" (Z→A),
   "category" (group by app type: browsers, productivity, dev, media, etc.)

RESPONSE — JSON only:
{"page":N,"order":[id,id,...],"success":true,"confidence":0.95,"reason":""}`;

export async function executeSortPage(
  ca: ClassifiedAction,
  grid: Grid,
  client: OpenAI,
  model: string
): Promise<ExecutorResult> {
  if (ca.targetPage == null) {
    return det(false, 1.0, 'No target page specified for sort', null);
  }
  const pageNum = ca.targetPage;
  const pageData = grid.pages.find((p) => p.page === pageNum);
  if (!pageData) {
    return det(false, 1.0, `Page ${pageNum} not found`, null);
  }

  const sortOrder = (ca.sortOrder ?? 'alphabetical') as SortPageMutations['order'];

  // Alphabetical sorts are deterministic — return the order, Swift applies it
  if (sortOrder === 'alphabetical' || sortOrder === 'reverse_alphabetical') {
    const mutations: SortPageMutations = { page: pageNum, order: sortOrder };
    return det(true, 1.0, '', mutations);
  }

  // Category sort — needs LLM
  const allPageApps = [...pageData.apps, ...(pageData.groups ?? []).flatMap((g) => g.apps)];
  const pageRepr = JSON.stringify({
    page: pageNum,
    apps: allPageApps.map((a) => ({ id: a.id, name: a.name, bundle: a.bundle })),
  });

  const messages = [
    { role: 'system' as const, content: SORT_PROMPT },
    { role: 'user' as const, content: `Page:\n${pageRepr}\n\nSort order: category` },
  ];

  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  const raw = resp.choices[0].message.content ?? '';
  const inTok = resp.usage?.prompt_tokens ?? 0;
  const outTok = resp.usage?.completion_tokens ?? 0;

  const data = extractJson(raw);
  const success = Boolean(data.success ?? true);
  const confidence = Number(data.confidence ?? 1.0);
  const reason = String(data.reason ?? '');
  const rawOrderedIds = ((data.order as unknown[]) ?? []).map(Number).filter((id) => !isNaN(id));

  // Validate: result must be a permutation of the page's actual app IDs (ISSUE-06)
  const expectedIds = new Set(allPageApps.map((a) => a.id));
  // Keep only IDs that belong to this page (no phantoms, no cross-page IDs)
  const seen = new Set<number>();
  const validOrdered = rawOrderedIds.filter((id) => {
    if (!expectedIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  // Append any IDs the LLM omitted so Swift always gets the full set
  const missingIds = allPageApps.map((a) => a.id).filter((id) => !seen.has(id));
  const orderedAppIds = [...validOrdered, ...missingIds];

  const mutations: SortPageMutations = { page: pageNum, order: 'category', orderedAppIds };
  return {
    success,
    confidence,
    reason,
    mutations,
    inputTokens: inTok,
    outputTokens: outTok,
    costUsd: calcCost(model, inTok, outTok),
    executorModel: model,
    rawPrompt: JSON.stringify(messages),
    rawResponse: raw,
  };
}

// ---------------------------------------------------------------------------
// rename_page / rename_group  (deterministic — no LLM)
// ---------------------------------------------------------------------------

export function executeRenamePage(ca: ClassifiedAction, grid: Grid): ExecutorResult {
  const pageNum = ca.targetPage ?? ca.sourcePage;
  const newName = (ca.newName ?? '').trim().slice(0, 64);

  if (!newName) {
    return det(false, 1.0, 'No new name provided', null);
  }
  if (!pageNum || !grid.pages.find((p) => p.page === pageNum)) {
    return det(false, 1.0, `Page ${pageNum} not found`, null);
  }

  const mutations: RenamePageMutations = { page: pageNum, newName };
  return det(true, 1.0, '', mutations);
}

export function executeRenameGroup(ca: ClassifiedAction, grid: Grid): ExecutorResult {
  const currentName = ca.groupName ?? '';
  const newName = (ca.newName ?? '').trim().slice(0, 64);

  if (!currentName || !newName) {
    return det(false, 1.0, 'Missing old or new group name', null);
  }

  const exists = grid.pages.some((p) =>
    (p.groups ?? []).some((g) => g.name.toLowerCase() === currentName.toLowerCase())
  );
  if (!exists) {
    return det(false, 1.0, `Group '${currentName}' not found`, null);
  }

  const mutations: RenameGroupMutations = { currentName, newName };
  return det(true, 1.0, '', mutations);
}

// ---------------------------------------------------------------------------
// ungroup  (deterministic — no LLM needed)
// ---------------------------------------------------------------------------

export function executeUngroup(ca: ClassifiedAction, grid: Grid): ExecutorResult {
  const groupName = ca.groupName ?? '';

  if (!groupName) {
    return det(false, 1.0, 'No group name provided', null);
  }

  // Find the group across all pages
  for (const page of grid.pages) {
    const group = (page.groups ?? []).find((g) => g.name.toLowerCase() === groupName.toLowerCase());
    if (group) {
      const mutations: UngroupMutations = { groupName: group.name };
      return det(true, 1.0, '', mutations);
    }
  }

  return det(false, 1.0, `Group '${groupName}' not found`, null);
}

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

const REMOVE_PROMPT = `\
You are an app grid organizer. Identify which apps from the grid match the \
filter and should be removed.

INPUT: [{"id":X,"name":"..."}]

RULES:
1. Only include apps that clearly match the filter.
2. Be conservative — if unsure, leave the app in.

RESPONSE — JSON only:
{"remove":[{"id":X,"name":"..."}],
  "success":true,"confidence":0.95,"reason":""}`;

export async function executeRemove(
  ca: ClassifiedAction,
  grid: Grid,
  client: OpenAI,
  model: string
): Promise<ExecutorResult> {
  const semantic = ca.filterType === 'semantic';
  const appsRepr = allAppsJson(grid, semantic);
  const userMsg = `Apps:\n${appsRepr}\n\nFilter: ${ca.filter ?? 'apps to remove'}`;

  const messages = [
    { role: 'system' as const, content: REMOVE_PROMPT },
    { role: 'user' as const, content: userMsg },
  ];

  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  const raw = resp.choices[0].message.content ?? '';
  const inTok = resp.usage?.prompt_tokens ?? 0;
  const outTok = resp.usage?.completion_tokens ?? 0;

  const data = extractJson(raw);
  const success = Boolean(data.success ?? true);
  const confidence = Number(data.confidence ?? 1.0);
  const reason = String(data.reason ?? '');

  const validIds = allAppIds(grid);
  const appIds = ((data.remove as Array<{ id: unknown }>) ?? [])
    .map((e) => Number(e.id))
    .filter((id) => !isNaN(id) && validIds.has(id));

  if (appIds.length === 0) {
    return {
      success: false,
      confidence,
      reason: reason || 'No matching apps found',
      mutations: null,
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd: calcCost(model, inTok, outTok),
      executorModel: model,
      rawPrompt: JSON.stringify(messages),
      rawResponse: raw,
    };
  }

  const mutations: RemoveMutations = { appIds };
  return {
    success,
    confidence,
    reason,
    mutations,
    inputTokens: inTok,
    outputTokens: outTok,
    costUsd: calcCost(model, inTok, outTok),
    executorModel: model,
    rawPrompt: JSON.stringify(messages),
    rawResponse: raw,
  };
}
