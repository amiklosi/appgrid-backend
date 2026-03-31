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
}

// ---------------------------------------------------------------------------
// Model costs (per 1M tokens, USD)
// ---------------------------------------------------------------------------

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4o-mini':  { input: 0.15, output: 0.60 },
  'gpt-4.1':      { input: 2.00, output: 8.00 },
  'gpt-4o':       { input: 2.50, output: 10.00 },
};

function calcCost(model: string, inTok: number, outTok: number): number {
  const c = MODEL_COSTS[model] ?? { input: 0, output: 0 };
  return (inTok * c.input + outTok * c.output) / 1_000_000;
}

function extractJson(text: string): Record<string, unknown> {
  text = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) {
    throw new Error(`No JSON in executor response: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text.slice(start, end));
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
      apps.push(includeBundle ? { id: a.id, name: a.name, bundle: a.bundle } : { id: a.id, name: a.name });
    }
    for (const g of page.groups ?? []) {
      for (const a of g.apps) {
        apps.push(includeBundle ? { id: a.id, name: a.name, bundle: a.bundle } : { id: a.id, name: a.name });
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
  model: string
): Promise<ExecutorResult> {
  // source_page set → deterministic, no LLM needed
  if (ca.sourcePage !== null) {
    const sourcePage = grid.pages.find((p) => p.page === ca.sourcePage);
    if (!sourcePage) {
      return { success: false, confidence: 1.0, reason: `Page ${ca.sourcePage} not found`, mutations: null, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }
    const mutations: MoveToPageMutations = {
      appIds: sourcePage.apps.map((a) => a.id),
      targetPage: ca.targetPage!,
    };
    return { success: true, confidence: 1.0, reason: '', mutations, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  const gridRepr = toJsonIds(grid);
  const userMsg =
    `Grid:\n${gridRepr}\n\n` +
    `Instruction: Move ${ca.filter ?? 'matching apps'} to page ${ca.targetPage}.`;

  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: MOVE_TO_PAGE_PROMPT },
      { role: 'user', content: userMsg },
    ],
    temperature: 0,
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

  const mutations: MoveToPageMutations = { appIds, targetPage: ca.targetPage! };

  return { success, confidence, reason, mutations, inputTokens: inTok, outputTokens: outTok, costUsd: calcCost(model, inTok, outTok) };
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
  model: string
): Promise<ExecutorResult> {
  const groupName = ca.groupName ?? 'New Group';
  const targetPage = ca.targetPage ?? 1;
  const semantic = ca.filterType === 'semantic';

  // source_page + no filter → deterministic
  if (ca.sourcePage !== null && !ca.filter) {
    const sourcePage = grid.pages.find((p) => p.page === ca.sourcePage);
    if (!sourcePage) {
      return { success: false, confidence: 1.0, reason: `Page ${ca.sourcePage} not found`, mutations: null, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }
    const appIds = [
      ...sourcePage.apps.map((a) => a.id),
      ...(sourcePage.groups ?? []).flatMap((g) => g.apps.map((a) => a.id)),
    ];
    const mutations: GroupMutations = { groupName, appIds, targetPage };
    return { success: true, confidence: 1.0, reason: '', mutations, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  // Build candidate pool
  let candidateApps: Array<{ id: number; name: string; bundle: string }>;
  if (ca.sourcePage !== null) {
    const sourcePage = grid.pages.find((p) => p.page === ca.sourcePage);
    if (!sourcePage) {
      return { success: false, confidence: 1.0, reason: `Page ${ca.sourcePage} not found`, mutations: null, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }
    candidateApps = [
      ...sourcePage.apps,
      ...(sourcePage.groups ?? []).flatMap((g) => g.apps),
    ];
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
    `Instruction: ${ca.filter ?? 'matching apps'} should go into a group named '${groupName}'.`;

  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: GROUP_PROMPT },
      { role: 'user', content: userMsg },
    ],
    temperature: 0,
  });

  const raw = resp.choices[0].message.content ?? '';
  const inTok = resp.usage?.prompt_tokens ?? 0;
  const outTok = resp.usage?.completion_tokens ?? 0;

  const data = extractJson(raw);
  const success = Boolean(data.success ?? true);
  const confidence = Number(data.confidence ?? 1.0);
  const reason = String(data.reason ?? '');
  const name = String(data.name || groupName);

  const validCandidateIds = new Set(candidateApps.map((a) => a.id));
  const appIds = ((data.apps as unknown[]) ?? [])
    .map((id) => Number(id))
    .filter((id) => !isNaN(id) && validCandidateIds.has(id));

  if (appIds.length === 0) {
    return { success: false, confidence, reason: reason || 'No matching apps found', mutations: null, inputTokens: inTok, outputTokens: outTok, costUsd: calcCost(model, inTok, outTok) };
  }

  const mutations: GroupMutations = { groupName: name, appIds, targetPage };
  return { success, confidence, reason, mutations, inputTokens: inTok, outputTokens: outTok, costUsd: calcCost(model, inTok, outTok) };
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
  const pageNum = ca.targetPage!;
  const pageData = grid.pages.find((p) => p.page === pageNum);
  if (!pageData) {
    return { success: false, confidence: 1.0, reason: `Page ${pageNum} not found`, mutations: null, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  const sortOrder = (ca.sortOrder ?? 'alphabetical') as SortPageMutations['order'];

  // Alphabetical sorts are deterministic — return the order, Swift applies it
  if (sortOrder === 'alphabetical' || sortOrder === 'reverse_alphabetical') {
    const mutations: SortPageMutations = { page: pageNum, order: sortOrder };
    return { success: true, confidence: 1.0, reason: '', mutations, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  // Category sort — needs LLM
  const allPageApps = [
    ...pageData.apps,
    ...(pageData.groups ?? []).flatMap((g) => g.apps),
  ];
  const pageRepr = JSON.stringify({
    page: pageNum,
    apps: allPageApps.map((a) => ({ id: a.id, name: a.name, bundle: a.bundle })),
  });

  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SORT_PROMPT },
      { role: 'user', content: `Page:\n${pageRepr}\n\nSort order: category` },
    ],
    temperature: 0,
  });

  const raw = resp.choices[0].message.content ?? '';
  const inTok = resp.usage?.prompt_tokens ?? 0;
  const outTok = resp.usage?.completion_tokens ?? 0;

  const data = extractJson(raw);
  const success = Boolean(data.success ?? true);
  const confidence = Number(data.confidence ?? 1.0);
  const reason = String(data.reason ?? '');
  const orderedAppIds = ((data.order as unknown[]) ?? []).map(Number).filter((id) => !isNaN(id));

  const mutations: SortPageMutations = { page: pageNum, order: 'category', orderedAppIds };
  return { success, confidence, reason, mutations, inputTokens: inTok, outputTokens: outTok, costUsd: calcCost(model, inTok, outTok) };
}

// ---------------------------------------------------------------------------
// rename_page / rename_group  (deterministic — no LLM)
// ---------------------------------------------------------------------------

export function executeRenamePage(ca: ClassifiedAction, grid: Grid): ExecutorResult {
  const pageNum = ca.targetPage ?? ca.sourcePage;
  const newName = ca.newName ?? '';

  if (!newName) {
    return { success: false, confidence: 1.0, reason: 'No new name provided', mutations: null, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }
  if (!pageNum || !grid.pages.find((p) => p.page === pageNum)) {
    return { success: false, confidence: 1.0, reason: `Page ${pageNum} not found`, mutations: null, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  const mutations: RenamePageMutations = { page: pageNum, newName };
  return { success: true, confidence: 1.0, reason: '', mutations, inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

export function executeRenameGroup(ca: ClassifiedAction, grid: Grid): ExecutorResult {
  const currentName = ca.groupName ?? '';
  const newName = ca.newName ?? '';

  if (!currentName || !newName) {
    return { success: false, confidence: 1.0, reason: 'Missing old or new group name', mutations: null, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  const exists = grid.pages.some((p) =>
    (p.groups ?? []).some((g) => g.name.toLowerCase() === currentName.toLowerCase())
  );
  if (!exists) {
    return { success: false, confidence: 1.0, reason: `Group '${currentName}' not found`, mutations: null, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  const mutations: RenameGroupMutations = { currentName, newName };
  return { success: true, confidence: 1.0, reason: '', mutations, inputTokens: 0, outputTokens: 0, costUsd: 0 };
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

  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: REMOVE_PROMPT },
      { role: 'user', content: userMsg },
    ],
    temperature: 0,
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
    return { success: false, confidence, reason: reason || 'No matching apps found', mutations: null, inputTokens: inTok, outputTokens: outTok, costUsd: calcCost(model, inTok, outTok) };
  }

  const mutations: RemoveMutations = { appIds };
  return { success, confidence, reason, mutations, inputTokens: inTok, outputTokens: outTok, costUsd: calcCost(model, inTok, outTok) };
}
