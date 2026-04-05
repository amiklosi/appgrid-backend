import { Static, Type } from '@sinclair/typebox';

// ---------------------------------------------------------------------------
// Grid input types (sent by Swift on every request)
// ---------------------------------------------------------------------------

export const AppEntrySchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  bundle: Type.String(),
});

export const GroupEntrySchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  apps: Type.Array(AppEntrySchema),
});

export const PageEntrySchema = Type.Object({
  page: Type.Integer({ minimum: 1 }),
  title: Type.Optional(Type.String()),
  apps: Type.Array(AppEntrySchema),
  groups: Type.Optional(Type.Array(GroupEntrySchema)),
});

export const GridSchema = Type.Object({
  pages: Type.Array(PageEntrySchema),
});

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const RearrangeRequestSchema = Type.Object({
  instruction: Type.String({ minLength: 1, maxLength: 500 }),
  grid: GridSchema,
  currentPage: Type.Optional(Type.Integer({ minimum: 1 })),
  maxItemsPerPage: Type.Optional(Type.Integer({ minimum: 1 })),
  machineId: Type.Optional(Type.String()),
  licenseKey: Type.Optional(Type.String()),
});

export type RearrangeRequest = Static<typeof RearrangeRequestSchema>;
export type Grid = Static<typeof GridSchema>;
export type PageEntry = Static<typeof PageEntrySchema>;
export type AppEntry = Static<typeof AppEntrySchema>;
export type GroupEntry = Static<typeof GroupEntrySchema>;

// ---------------------------------------------------------------------------
// Mutation payloads (what Swift applies to its tree)
// ---------------------------------------------------------------------------

export interface MoveToPageMutations {
  appIds: number[];
  targetPage: number;
}

export interface GroupMutations {
  groupName: string;
  appIds: number[];
  targetPage: number;
}

export interface SortPageMutations {
  page: number;
  order: 'alphabetical' | 'reverse_alphabetical' | 'category';
  orderedAppIds?: number[]; // only populated for category sort
}

export interface RenamePageMutations {
  page: number;
  newName: string;
}

export interface RenameGroupMutations {
  currentName: string;
  newName: string;
}

export interface RemoveMutations {
  appIds: number[];
}

export interface UngroupMutations {
  groupName: string;
}

export type AnyMutations =
  | MoveToPageMutations
  | GroupMutations
  | SortPageMutations
  | RenamePageMutations
  | RenameGroupMutations
  | RemoveMutations
  | UngroupMutations;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export const RearrangeResponseSchema = Type.Object({
  id: Type.String(),
  action: Type.String(),
  success: Type.Boolean(),
  confidence: Type.Number(),
  reason: Type.String(),
  mutations: Type.Optional(Type.Any()),
});

export type RearrangeResponse = Static<typeof RearrangeResponseSchema>;

// ---------------------------------------------------------------------------
// Outcome endpoint
// ---------------------------------------------------------------------------

export const VALID_OUTCOMES = ['accepted', 'undone', 'failed_to_apply'] as const;
export type OutcomeValue = (typeof VALID_OUTCOMES)[number];

export const OutcomeRequestSchema = Type.Object({
  machineId: Type.String({ minLength: 1 }),
  outcome: Type.Union(VALID_OUTCOMES.map((o) => Type.Literal(o)) as any),
  reason: Type.Optional(Type.String()),
});

export type OutcomeRequest = Static<typeof OutcomeRequestSchema>;

export const OutcomeResponseSchema = Type.Object({
  success: Type.Boolean(),
});
