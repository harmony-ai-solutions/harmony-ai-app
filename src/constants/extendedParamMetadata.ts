export interface ExtendedParamInfo {
  label: string;
  key: string;
  type: 'number' | 'boolean';
  step?: number;
  min?: number;
  max?: number;
  tooltip: string;
}

export const EXTENDED_PARAMS: ExtendedParamInfo[] = [
  { key: 'typical_p', label: 'Typical P', type: 'number', step: 0.01, min: 0, max: 1, tooltip: 'Locally typical sampling threshold' },
  { key: 'tfs', label: 'TFS', type: 'number', step: 0.01, min: 0, max: 1, tooltip: 'Tail Free Sampling' },
  { key: 'dry_multiplier', label: 'DRY Multiplier', type: 'number', step: 0.01, min: 0, max: 10, tooltip: 'DRY penalty for repetition' },
  { key: 'dry_base', label: 'DRY Base', type: 'number', step: 0.01, min: 0, max: 10, tooltip: 'DRY penalty base' },
  { key: 'dry_allowed_length', label: 'DRY Allowed Length', type: 'number', step: 1, min: 0, max: 100, tooltip: 'DRY allowed repetition length' },
  { key: 'xtc_probability', label: 'XTC Probability', type: 'number', step: 0.01, min: 0, max: 1, tooltip: 'XTC sampling probability' },
  { key: 'xtc_threshold', label: 'XTC Threshold', type: 'number', step: 0.01, min: 0, max: 1, tooltip: 'XTC sampling threshold' },
  { key: 'mirostat_mode', label: 'Mirostat Mode', type: 'number', step: 1, min: 0, max: 2, tooltip: '0=disabled, 1=Mirostat, 2=Mirostat 2.0' },
  { key: 'mirostat_tau', label: 'Mirostat Tau', type: 'number', step: 0.01, min: 0, max: 10, tooltip: 'Target entropy' },
  { key: 'mirostat_eta', label: 'Mirostat Eta', type: 'number', step: 0.01, min: 0, max: 1, tooltip: 'Learning rate' },
  { key: 'dynatemp_range', label: 'Dynamic Temp Range', type: 'number', step: 0.01, min: 0, max: 2, tooltip: 'Dynamic temperature range' },
  { key: 'dynatemp_exponent', label: 'Dynamic Temp Exponent', type: 'number', step: 0.01, min: 0, max: 5, tooltip: 'Dynamic temperature exponent' },
  { key: 'penalty_alpha', label: 'Penalty Alpha', type: 'number', step: 0.01, min: 0, max: 1, tooltip: 'Contrastive search penalty' },
  { key: 'epsilon_cutoff', label: 'Epsilon Cutoff', type: 'number', step: 0.01, min: 0, max: 1, tooltip: 'Epsilon cutoff for sampling' },
  { key: 'eta_cutoff', label: 'ETA Cutoff', type: 'number', step: 0.01, min: 0, max: 1, tooltip: 'ETA cutoff for sampling' },
  { key: 'do_sample', label: 'Do Sample', type: 'boolean', tooltip: 'Enable sampling (TextGen only)' },
  { key: 'temperature_last', label: 'Temperature Last', type: 'boolean', tooltip: 'Apply temperature as last sampler' },
  { key: 'ignore_eos', label: 'Ignore EOS', type: 'boolean', tooltip: 'Ignore end-of-sequence token' },
];

export const STANDARD_PARAM_KEYS = new Set([
  'temperature', 'top_p', 'max_tokens', 'frequency_penalty', 'presence_penalty',
  'seed', 'top_k', 'min_p', 'repetition_penalty', 'top_a',
  'max_completion_tokens', 'response_format', 'reasoning_effort',
]);