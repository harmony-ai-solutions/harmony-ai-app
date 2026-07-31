/**
 * Character Card Types
 *
 * Faithful port of harmony-link-private/utils/charactercard/types.go
 * Exact JSON keys, field names, and structure.
 */

export class CharacterCardParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CharacterCardParseError';
  }
}

export interface TavernCardV2 {
  spec: string;
  spec_version: string;
  data: TavernCardV2Data;
}

export interface TavernCardV2Data {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  character_book: CharacterBook | null;
  tags: string[];
  creator: string;
  character_version: string;
  extensions: Record<string, unknown>;
}

export interface CharacterBook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: CharacterBookEntry[];
}

export interface CharacterBookEntry {
  keys: string[];
  content: string;
  extensions: Record<string, unknown>;
  enabled: boolean;
  insertion_order: number;
}

export interface TavernCardV1 {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
}
