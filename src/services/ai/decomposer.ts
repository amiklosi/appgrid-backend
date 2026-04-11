/**
 * Splits compound user instructions into ordered sub-instructions.
 *
 * Single-action instructions pass through unchanged (returns a 1-element array).
 * Compound instructions like "group browsers and text editors" are split into
 * independent sub-instructions that can each be classified and executed separately.
 */

import OpenAI from 'openai';

const MAX_SUB_INSTRUCTIONS = 5;

const SYSTEM_PROMPT = `\
You split compound app-grid instructions into independent sub-instructions.

Supported operations (for reference — do NOT classify, only split):
  move_to_page, create_group, move_to_group, sort_page,
  rename_page, rename_group, ungroup, remove

RULES:
1. If the instruction is a single operation, return it as-is in a 1-element array.
2. If the instruction contains multiple operations joined by "and", "then", commas,
   or semicolons, split into separate self-contained sub-instructions.
3. Each sub-instruction must be a complete, standalone sentence that makes sense
   on its own (include context like page numbers, not just "do the same for page 2").
4. Preserve the user's original language (German, French, etc.) — do not translate.
5. Preserve execution order — earlier sub-instructions run first.
6. Maximum ${MAX_SUB_INSTRUCTIONS} sub-instructions. If more, keep the first ${MAX_SUB_INSTRUCTIONS}.
7. Do NOT split a single operation that mentions multiple apps/categories as its filter
   (e.g. "move Chrome and Firefox to page 2" is ONE operation, not two).
   Only split when there are genuinely different operations.

RESPONSE — JSON only:
{"instructions":["sub-instruction 1","sub-instruction 2"]}

EXAMPLES:
"group browsers and text editors"
→ {"instructions":["group browsers","group text editors"]}

"move Apple apps to page 1 and Microsoft apps to page 2"
→ {"instructions":["move Apple apps to page 1","move Microsoft apps to page 2"]}

"sort page 1 and page 2 alphabetically"
→ {"instructions":["sort page 1 alphabetically","sort page 2 alphabetically"]}

"put dev tools in a folder and move games to page 5"
→ {"instructions":["put dev tools in a folder","move games to page 5"]}

"move Chrome and Firefox to page 2"
→ {"instructions":["move Chrome and Firefox to page 2"]}

"sort page 3 alphabetically"
→ {"instructions":["sort page 3 alphabetically"]}`;

export async function decompose(
  instruction: string,
  client: OpenAI,
  model: string = 'gpt-4.1-nano'
): Promise<{ instructions: string[]; inputTokens: number; outputTokens: number }> {
  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: instruction },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  const raw = resp.choices[0].message.content ?? '';
  const inTok = resp.usage?.prompt_tokens ?? 0;
  const outTok = resp.usage?.completion_tokens ?? 0;

  try {
    const data = JSON.parse(raw);
    let instructions = Array.isArray(data.instructions) ? data.instructions : [instruction];

    // Sanitize: filter non-strings, enforce cap
    instructions = instructions.filter(
      (s: unknown) => typeof s === 'string' && s.trim().length > 0
    );
    if (instructions.length === 0) instructions = [instruction];
    if (instructions.length > MAX_SUB_INSTRUCTIONS)
      instructions = instructions.slice(0, MAX_SUB_INSTRUCTIONS);

    return { instructions, inputTokens: inTok, outputTokens: outTok };
  } catch {
    // JSON parse failure — fall back to single instruction
    return { instructions: [instruction], inputTokens: inTok, outputTokens: outTok };
  }
}
