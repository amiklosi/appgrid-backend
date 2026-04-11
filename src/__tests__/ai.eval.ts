/**
 * AI eval suite — runs against the real LLM backend (no mocks).
 *
 * Usage:
 *   npx ts-node src/__tests__/ai.eval.ts              # run all
 *   npx ts-node src/__tests__/ai.eval.ts decomposer   # run one section
 *   npx ts-node src/__tests__/ai.eval.ts classifier
 *   npx ts-node src/__tests__/ai.eval.ts e2e
 *
 * Requires OPENAI_API_KEY in .env or environment.
 */

import 'dotenv/config';
import OpenAI from 'openai';
import { decompose } from '../services/ai/decomposer';
import { classify } from '../services/ai/classifier';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

interface TestCase {
  name: string;
  fn: () => Promise<void>;
}

const sections: Map<string, TestCase[]> = new Map();
let currentSection = '';

function section(name: string) {
  currentSection = name;
  sections.set(name, []);
}

function test(name: string, fn: () => Promise<void>) {
  sections.get(currentSection)!.push({ name, fn });
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// ---------------------------------------------------------------------------
// Shared grid fixture — realistic macOS app grid
// ---------------------------------------------------------------------------

const GRID = {
  pages: [
    {
      page: 1,
      title: 'Main',
      apps: [
        { id: 1, name: 'Safari', bundle: 'com.apple.Safari' },
        { id: 2, name: 'Google Chrome', bundle: 'com.google.Chrome' },
        { id: 3, name: 'Firefox', bundle: 'org.mozilla.firefox' },
        { id: 4, name: 'Brave Browser', bundle: 'com.brave.Browser' },
        { id: 5, name: 'Mail', bundle: 'com.apple.mail' },
        { id: 6, name: 'Calendar', bundle: 'com.apple.iCal' },
        { id: 7, name: 'Notes', bundle: 'com.apple.Notes' },
        { id: 8, name: 'Reminders', bundle: 'com.apple.reminders' },
        { id: 9, name: 'VS Code', bundle: 'com.microsoft.VSCode' },
        { id: 10, name: 'Xcode', bundle: 'com.apple.dt.Xcode' },
        { id: 11, name: 'Terminal', bundle: 'com.apple.Terminal' },
        { id: 12, name: 'iTerm', bundle: 'com.googlecode.iterm2' },
        { id: 13, name: 'Microsoft Word', bundle: 'com.microsoft.Word' },
        { id: 14, name: 'Microsoft Excel', bundle: 'com.microsoft.Excel' },
        { id: 15, name: 'Microsoft PowerPoint', bundle: 'com.microsoft.Powerpoint' },
        { id: 16, name: 'Microsoft Teams', bundle: 'com.microsoft.teams2' },
        { id: 17, name: 'Slack', bundle: 'com.tinyspeck.slackmacgap' },
        { id: 18, name: 'Spotify', bundle: 'com.spotify.client' },
        { id: 19, name: 'Photos', bundle: 'com.apple.Photos' },
        { id: 20, name: 'Preview', bundle: 'com.apple.Preview' },
      ],
      groups: [],
    },
    {
      page: 2,
      title: 'More',
      apps: [
        { id: 21, name: 'Finder', bundle: 'com.apple.finder' },
        { id: 22, name: 'System Preferences', bundle: 'com.apple.systempreferences' },
        { id: 23, name: 'Activity Monitor', bundle: 'com.apple.ActivityMonitor' },
        { id: 24, name: 'Disk Utility', bundle: 'com.apple.DiskUtility' },
        { id: 25, name: 'TextEdit', bundle: 'com.apple.TextEdit' },
        { id: 26, name: 'Sublime Text', bundle: 'com.sublimetext.4' },
        { id: 27, name: 'Notion', bundle: 'notion.id' },
        { id: 28, name: 'Figma', bundle: 'com.figma.Desktop' },
      ],
      groups: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Decomposer tests
// ---------------------------------------------------------------------------

section('decomposer');

test('single instruction passes through', async () => {
  const r = await decompose('group browsers', openai);
  assert(r.instructions.length === 1, `Expected 1, got ${r.instructions.length}`);
});

test('splits "group browsers and text editors"', async () => {
  const r = await decompose('group browsers and text editors', openai);
  assert(
    r.instructions.length === 2,
    `Expected 2, got ${r.instructions.length}: ${JSON.stringify(r.instructions)}`
  );
  assert(
    r.instructions.some((i) => /browser/i.test(i)),
    `No browser instruction: ${JSON.stringify(r.instructions)}`
  );
  assert(
    r.instructions.some((i) => /text editor/i.test(i)),
    `No text editor instruction: ${JSON.stringify(r.instructions)}`
  );
});

test('carries page context to all sub-instructions', async () => {
  const r = await decompose('group browsers and MS apps on this page', openai);
  assert(
    r.instructions.length === 2,
    `Expected 2, got ${r.instructions.length}: ${JSON.stringify(r.instructions)}`
  );
  for (const instr of r.instructions) {
    assert(
      /this page|current page/i.test(instr),
      `Sub-instruction missing page context: "${instr}"`
    );
  }
});

test('does not split "move Chrome and Firefox to page 2"', async () => {
  const r = await decompose('move Chrome and Firefox to page 2', openai);
  assert(
    r.instructions.length === 1,
    `Should not split, got ${r.instructions.length}: ${JSON.stringify(r.instructions)}`
  );
});

test('splits "move Apple apps to page 1 and Microsoft apps to page 2"', async () => {
  const r = await decompose('move Apple apps to page 1 and Microsoft apps to page 2', openai);
  assert(
    r.instructions.length === 2,
    `Expected 2, got ${r.instructions.length}: ${JSON.stringify(r.instructions)}`
  );
});

test('splits "sort page 1 and page 2 alphabetically"', async () => {
  const r = await decompose('sort page 1 and page 2 alphabetically', openai);
  assert(
    r.instructions.length === 2,
    `Expected 2, got ${r.instructions.length}: ${JSON.stringify(r.instructions)}`
  );
  for (const instr of r.instructions) {
    assert(/alphabetical/i.test(instr), `Sub-instruction missing sort order: "${instr}"`);
  }
});

test('handles German compound instruction', async () => {
  const r = await decompose('Browser gruppieren und Seite 2 sortieren', openai);
  assert(
    r.instructions.length === 2,
    `Expected 2, got ${r.instructions.length}: ${JSON.stringify(r.instructions)}`
  );
});

// ---------------------------------------------------------------------------
// Classifier tests
// ---------------------------------------------------------------------------

section('classifier');

test('"group browsers" → create_group, no source_page', async () => {
  const r = await classify('group browsers', openai, { pageCount: 2, currentPage: 1 });
  assert(r.action === 'create_group', `Expected create_group, got ${r.action}`);
  assert(r.sourcePage === null, `Expected source_page=null (global), got ${r.sourcePage}`);
  assert(r.filterType === 'semantic', `Expected semantic filter, got ${r.filterType}`);
});

test('"group browsers on this page" → create_group, source_page=current', async () => {
  const r = await classify('group browsers on this page', openai, { pageCount: 2, currentPage: 1 });
  assert(r.action === 'create_group', `Expected create_group, got ${r.action}`);
  assert(r.sourcePage === 1, `Expected source_page=1, got ${r.sourcePage}`);
});

test('"sort page 2 alphabetically" → sort_page', async () => {
  const r = await classify('sort page 2 alphabetically', openai, { pageCount: 2, currentPage: 1 });
  assert(r.action === 'sort_page', `Expected sort_page, got ${r.action}`);
  assert(r.sortOrder === 'alphabetical', `Expected alphabetical, got ${r.sortOrder}`);
});

test('"move Apple apps to page 1" → move_to_page', async () => {
  const r = await classify('move Apple apps to page 1', openai, { pageCount: 2, currentPage: 2 });
  assert(r.action === 'move_to_page', `Expected move_to_page, got ${r.action}`);
  assert(r.targetPage === 1, `Expected target_page=1, got ${r.targetPage}`);
  assert(r.sourcePage === null, `Expected source_page=null, got ${r.sourcePage}`);
});

test('"remove uninstallers" → remove', async () => {
  const r = await classify('remove uninstallers', openai, { pageCount: 2, currentPage: 1 });
  assert(r.action === 'remove', `Expected remove, got ${r.action}`);
});

test('"organize my apps" → unknown (too vague)', async () => {
  const r = await classify('organize my apps', openai, { pageCount: 2, currentPage: 1 });
  assert(r.action === 'unknown', `Expected unknown, got ${r.action}`);
});

test('"rename the Games folder to Gaming" → rename_group', async () => {
  const r = await classify('rename the Games folder to Gaming', openai, {
    pageCount: 2,
    currentPage: 1,
  });
  assert(r.action === 'rename_group', `Expected rename_group, got ${r.action}`);
});

test('"Browsern auf dieser Seite gruppieren" → create_group, source_page=current', async () => {
  const r = await classify('Browsern auf dieser Seite gruppieren', openai, {
    pageCount: 2,
    currentPage: 1,
  });
  assert(r.action === 'create_group', `Expected create_group, got ${r.action}`);
  assert(r.sourcePage === 1, `Expected source_page=1, got ${r.sourcePage}`);
});

// ---------------------------------------------------------------------------
// E2E tests (hit the local server)
// ---------------------------------------------------------------------------

section('e2e');

const API_URL = process.env.AI_EVAL_URL || 'http://localhost:3000';

async function rearrange(instruction: string, currentPage = 1): Promise<any> {
  const res = await fetch(`${API_URL}/api/ai/rearrange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instruction,
      grid: GRID,
      currentPage,
      maxItemsPerPage: 35,
      machineId: 'eval-device',
      licenseKey: 'DEBUG-PRO-KEY',
    }),
  });
  return res.json();
}

test('single: "group browsers" returns create_group with browser IDs', async () => {
  const r = await rearrange('group browsers');
  assert(r.success === true, `Expected success, got: ${r.reason}`);
  assert(r.action === 'create_group', `Expected create_group, got ${r.action}`);
  assert(
    r.mutations?.appIds?.length >= 2,
    `Expected >=2 browser apps, got ${r.mutations?.appIds?.length}`
  );
});

test('compound: "group browsers and text editors" returns steps', async () => {
  const r = await rearrange('group browsers and text editors');
  assert(r.action === 'compound', `Expected compound, got ${r.action}`);
  assert(r.success === true, `Expected success, got: ${r.reason}`);
  assert(r.steps?.length === 2, `Expected 2 steps, got ${r.steps?.length}`);
  const names = r.steps.map((s: any) => s.mutations?.groupName);
  assert(
    names.some((n: string) => /browser/i.test(n)),
    `No Browsers group: ${JSON.stringify(names)}`
  );
});

test('compound: "move Apple apps to page 1 and MS apps to page 2"', async () => {
  const r = await rearrange('move Apple apps to page 1 and Microsoft apps to page 2', 2);
  assert(r.action === 'compound', `Expected compound, got ${r.action}`);
  assert(r.success === true, `Expected success, got: ${r.reason}`);
  assert(r.steps?.length === 2, `Expected 2 steps, got ${r.steps?.length}`);
});

test('e2e: "group browsers" searches all pages (global)', async () => {
  const r = await rearrange('group browsers', 2);
  assert(r.success === true, `Expected success, got: ${r.reason}`);
  // Safari (id=1) is on page 1, should be included even though currentPage=2
  const ids: number[] = r.mutations?.appIds ?? r.steps?.[0]?.mutations?.appIds ?? [];
  assert(ids.includes(1), `Expected Safari (id=1) from page 1, got IDs: ${JSON.stringify(ids)}`);
});

test('e2e: "group browsers on this page" scopes to current page', async () => {
  // Page 2 has no browsers — the executor should fail or return 0 apps
  const r = await rearrange('group browsers on this page', 2);
  const ids: number[] = r.mutations?.appIds ?? [];
  assert(
    !r.success || ids.length === 0,
    `Expected no browsers on page 2, got IDs: ${JSON.stringify(ids)}`
  );
  // Crucially: Safari (id=1) from page 1 must NOT be included
  assert(!ids.includes(1), `Safari (page 1) should not be included when scoped to page 2`);
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function run() {
  const filter = process.argv[2]; // optional: "decomposer", "classifier", "e2e"
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const [sectionName, tests] of sections) {
    if (filter && sectionName !== filter) {
      skipped += tests.length;
      continue;
    }

    console.log(`\n--- ${sectionName} ---`);

    for (const t of tests) {
      try {
        await t.fn();
        console.log(`  ✓ ${t.name}`);
        passed++;
      } catch (err: any) {
        console.log(`  ✗ ${t.name}`);
        console.log(`    ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
