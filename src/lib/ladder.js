// The graduated feedback ladder (Aljaafreh & Lantolf's regulatory scale ×
// Lyster's prompts-before-recasts): help escalates one rung at a time, and
// the rung a learner needed to fix an error is itself the progress measure.
//
// The engine returns the full analysis in one call; the ladder is enforced
// client-side by progressive disclosure — nothing above the current rung is
// shown, and the correction (rung 5) is always available but never first.

export const RUNGS = [
  { key: 'locate',    level: 1, label: 'Locate it yourself',
    reveal: 'A sentence contains an error — find it.' },
  { key: 'underline', level: 2, label: 'Show me where',
    reveal: 'The error span is underlined, nothing more.' },
  { key: 'code',      level: 3, label: 'What kind of error?',
    reveal: 'The pattern code and name (e.g. WO-VF — verb-final).' },
  { key: 'explain',   level: 4, label: 'Explain the rule',
    reveal: 'A metalinguistic explanation of the rule as it applies here.' },
  { key: 'correct',   level: 5, label: 'Show the correction',
    reveal: 'The corrected form.' },
]

export const MAX_RUNG = RUNGS.length

export function rungLabel(level) {
  const rung = RUNGS.find((r) => r.level === level)
  return rung ? rung.label : null
}

// The next rung level after `level`, or null when the ladder is exhausted.
export function nextRung(level) {
  return level < MAX_RUNG ? level + 1 : null
}

// A short human-readable trajectory summary, e.g. "L4 → L2 → L1".
// Falling rungs over time = internalization (dynamic assessment).
export function rungTrajectory(levels) {
  if (!levels || levels.length === 0) return ''
  return levels.map((l) => `L${l}`).join(' → ')
}
