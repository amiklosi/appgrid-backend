/**
 * classifier.ts
 * Classifies a free-text grid instruction into a structured action + parameters.
 * Single cheap gpt-4.1-nano call using JSON mode. Ported from classifier.py.
 */

import OpenAI from 'openai';

export type ActionType =
  | 'move_to_page'
  | 'create_group'
  | 'move_to_group'
  | 'sort_page'
  | 'rename_page'
  | 'rename_group'
  | 'remove'
  | 'unknown';

export interface ClassifiedAction {
  action: ActionType;
  confidence: number;
  filter: string | null;
  filterType: 'name_based' | 'semantic' | null;
  targetPage: number | null;
  sourcePage: number | null;
  groupName: string | null;
  newName: string | null;
  sortOrder: 'alphabetical' | 'reverse_alphabetical' | 'category' | null;
  reason: string | null;
}

// ---------------------------------------------------------------------------
// System prompt — verbatim port from classifier.py
// ---------------------------------------------------------------------------

const BASE_SYSTEM_PROMPT = `\
You are an intent classifier for a macOS app launcher grid assistant.
The user will give a free-text instruction about rearranging their app grid.

You support EXACTLY these operations — nothing else:

  move_to_page  — move a specific set of apps to a single named/numbered page
                  Requires: a clear app filter OR a source page, AND a specific target page.
                  Example: "Move music apps to page 3", "Move everything on page 2 to page 5"

  create_group  — create a new named folder containing a specific set of apps
                  Requires: a clear app filter OR a source page. Group name is optional —
                  if not stated, infer a sensible name from the filter (e.g. "dev tools" → "Dev Tools").
                  Optional: target_page — which page to place the folder on (default 1).
                  Example: "Put all browsers in a folder called Browsers"
                  Example: "Group my dev tools on this page"
                  Example: "Put all browsers in a folder called Browsers on page 3"

  move_to_group — move a specific set of apps into an existing named folder
                  Requires: a clear app filter AND an existing group name to move into.
                  Optional: target_page — which page to place the folder on if it needs to be created.
                  Example: "Move Spotify into the Music group"
                  Example: "Move Spotify into the Music group on page 2"

  sort_page     — sort apps on a single specific page
                  Requires: a specific page number, AND a sort order (alphabetical /
                  reverse_alphabetical / category).
                  Example: "Sort page 2 alphabetically"

  rename_page   — rename a single page
                  Requires: a specific page number or current name, AND a new name.
                  Example: "Rename page 3 to Work"

  rename_group  — rename an existing folder
                  Requires: the current folder name AND a new name.
                  Example: "Rename the Games folder to Gaming"

  remove        — remove a specific set of apps from the grid entirely
                  Requires: a clear app filter.
                  Example: "Remove all the uninstaller apps"

  unknown       — use this when the instruction does not map cleanly to one of the above.

CLASSIFY AS unknown (action="unknown") IN ALL OF THESE CASES — no exceptions:
  - The instruction asks for more than one of the above operations at once.
    → reason: "Please give one instruction at a time."
  - The instruction is vague or open-ended with no specific target
    (e.g. "organise my grid", "make sensible groups", "clean up page 1", "make it look nice").
    → reason: "Too vague — please be specific, e.g. 'put browsers in a folder called Browsers'."
  - The instruction asks a question or requests information about the grid.
    → reason: "I can only rearrange apps, not answer questions about the grid."
  - The instruction asks to move or reorder an entire folder/group as a unit.
    → reason: "I can move apps into or out of groups, but not move a whole group to another page."
  - The instruction targets a specific grid position (row, column, slot).
    → reason: "I can move apps to a page but not to a specific row or column."
  - The instruction asks to undo, revert, or restore a previous state.
    → reason: "Undo is not supported."
  - The instruction does not clearly fit one of the seven supported operations above.
    → reason: "I can only move apps, create/rename groups, sort or rename pages, and remove apps."

PARAMETERS — only include what's relevant:
  filter        — natural-language description of which apps to act on.
                  Use null if source_page is set instead.
  filter_type   — how the filter should be applied:
                  "name_based" — filter is a rule about the app's displayed name
                                 (e.g. "starts with A", "contains 'pro'", "named Spotify").
                  "semantic"   — filter is a category or concept that requires
                                 knowledge of what the app does
                                 (e.g. "browsers", "music apps", "uninstallers").
                  Use null if filter is null.
  target_page   — integer destination page (1-based), or null.
  source_page   — integer source page (1-based), ONLY when the instruction says
                  "all apps on page N". Never set for sort, rename, or remove.
  group_name    — folder name (new or existing). For create_group, if the user doesn't
                  state a name, infer a concise title-cased name from the filter
                  (e.g. filter "dev tools" → group_name "Dev Tools"). Never leave null
                  for create_group.
  new_name      — new name for rename operations.
  sort_order    — "alphabetical", "reverse_alphabetical", or "category".
  reason        — required when action=unknown; optional caveat otherwise.

RESPONSE — JSON only, no markdown:
{
  "action": "move_to_page",
  "confidence": 0.97,
  "filter": "music apps",
  "filter_type": "semantic",
  "target_page": 6,
  "source_page": null,
  "group_name": null,
  "new_name": null,
  "sort_order": null,
  "reason": null
}

Always include all 10 fields. Use null for fields that don't apply.
`;

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

export async function classify(
  instruction: string,
  client: OpenAI,
  options: {
    pageCount?: number;
    currentPage?: number;
    model?: string;
  } = {}
): Promise<ClassifiedAction> {
  const { pageCount, currentPage, model = 'gpt-4.1-nano' } = options;

  // Inject grid context (mirrors classifier.py context injection)
  const contextLines: string[] = [];
  if (pageCount !== undefined) {
    contextLines.push(
      `The grid currently has ${pageCount} page(s). ` +
        `When the instruction refers to 'a new page', 'the next page', or ` +
        `'a fresh page', set target_page=${pageCount + 1}.`
    );
  }
  if (currentPage !== undefined) {
    contextLines.push(
      `The user is currently viewing page ${currentPage}. ` +
        `When the instruction refers to 'this page', 'the current page', ` +
        `'here', or similar, resolve it to page ${currentPage} — use ` +
        `source_page=${currentPage} for move/group actions, or ` +
        `target_page=${currentPage} for sort/rename actions.`
    );
  }

  let system = BASE_SYSTEM_PROMPT;
  if (contextLines.length > 0) {
    const contextBlock =
      '\n\nGRID CONTEXT:\n' + contextLines.map((l) => `- ${l}`).join('\n');
    system = system.replace(
      'CLASSIFY AS unknown',
      contextBlock + '\n\nCLASSIFY AS unknown'
    );
  }

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: instruction },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0].message.content ?? '';
  const data = extractJson(raw);

  return {
    action: (data.action as ActionType) ?? 'unknown',
    confidence: Number(data.confidence ?? 0),
    filter: data.filter ? String(data.filter) : null,
    filterType: data.filter_type ? (String(data.filter_type) as ClassifiedAction['filterType']) : null,
    targetPage: data.target_page != null ? Number(data.target_page) : null,
    sourcePage: data.source_page != null ? Number(data.source_page) : null,
    groupName: data.group_name ? String(data.group_name) : null,
    newName: data.new_name ? String(data.new_name) : null,
    sortOrder: data.sort_order ? (String(data.sort_order) as ClassifiedAction['sortOrder']) : null,
    reason: data.reason ? String(data.reason) : null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractJson(text: string): Record<string, unknown> {
  // Strip markdown code fences if present
  text = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) {
    throw new Error(`No JSON object in classifier response: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text.slice(start, end));
}
