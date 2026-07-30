// The error ledger — the app's data spine. The unit is an error *pattern*
// (not a word), and every function here is pure: (ledger, ...) → new ledger.
// Persistence lives in store.js; components never mutate ledger objects.
//
// Shape: { [code]: { code, occurrences: [{ sessionId, date, quote, rung }],
//                    notes: [{ date, text }] } }

export const MAX_ACTIVE_TARGETS = 3

function emptyEntry(code) {
  return { code, occurrences: [], notes: [] }
}

export function recordOccurrence(ledger, code, occurrence) {
  const entry = ledger[code] || emptyEntry(code)
  return {
    ...ledger,
    [code]: { ...entry, occurrences: [...entry.occurrences, occurrence] },
  }
}

export function addNote(ledger, code, text, date) {
  const trimmed = (text || '').trim()
  if (!trimmed) return ledger
  const entry = ledger[code] || emptyEntry(code)
  return {
    ...ledger,
    [code]: { ...entry, notes: [...entry.notes, { date, text: trimmed }] },
  }
}

export function patternStats(ledger, code) {
  const entry = ledger[code]
  if (!entry || entry.occurrences.length === 0) {
    return { count: 0, lastSeen: null, lastRung: null, rungs: [] }
  }
  const occ = entry.occurrences
  const rungs = occ.map((o) => o.rung).filter((r) => r != null)
  return {
    count: occ.length,
    lastSeen: occ[occ.length - 1].date,
    lastRung: rungs.length ? rungs[rungs.length - 1] : null,
    rungs,
  }
}

// Suggest active targets: the most frequent patterns over the recent window,
// ties broken by recency. Focused-WCF finding: never more than MAX targets.
// `allow` (a Set of codes, or null) applies the Processability gate — see
// stage.js. Null means no gate, which is what an evidence-free diagnosis gives.
export function suggestTargets(
  ledger,
  { max = MAX_ACTIVE_TARGETS, recentDays = 28, now = new Date(), allow = null } = {}
) {
  const cutoff = new Date(now.getTime() - recentDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  const scored = Object.values(ledger)
    .map((entry) => {
      const recent = entry.occurrences.filter((o) => o.date >= cutoff)
      const lastSeen = entry.occurrences.length
        ? entry.occurrences[entry.occurrences.length - 1].date
        : ''
      return { code: entry.code, recentCount: recent.length, lastSeen }
    })
    .filter((s) => s.recentCount > 0 && (!allow || allow.has(s.code)))
  // Most frequent first, then most recent. The tiebreak must return 0 on equal
  // dates — returning 1 for both (a,b) and (b,a) is an inconsistent comparator
  // and left tied patterns in implementation-defined order.
  scored.sort(
    (a, b) =>
      b.recentCount - a.recentCount ||
      (a.lastSeen === b.lastSeen ? 0 : a.lastSeen < b.lastSeen ? 1 : -1)
  )
  return scored.slice(0, max).map((s) => s.code)
}

// The ledger is a pure fold over completed sessions, not stored state — every
// occurrence and note already lives on the session that produced it, so
// deriving avoids two sources of truth that can drift apart. Sessions must be
// passed oldest-first so occurrence order (and therefore the rung trajectory)
// matches the order they were actually worked through.
export function buildLedger(sessions) {
  let ledger = {}
  for (const session of sessions || []) {
    for (const err of session.errors || []) {
      if (!err?.patternCode) continue
      ledger = recordOccurrence(ledger, err.patternCode, {
        sessionId: session.id,
        date: session.date,
        quote: err.quote,
        rung: err.rung ?? null,
      })
    }
    for (const [code, text] of Object.entries(session.notes || {})) {
      ledger = addNote(ledger, code, text, session.date)
    }
  }
  return ledger
}

// All codes that appear in a session's error list, deduped, in first-seen order.
export function sessionPatternCodes(errors) {
  const seen = new Set()
  const out = []
  for (const e of errors || []) {
    if (e.patternCode && !seen.has(e.patternCode)) {
      seen.add(e.patternCode)
      out.push(e.patternCode)
    }
  }
  return out
}
