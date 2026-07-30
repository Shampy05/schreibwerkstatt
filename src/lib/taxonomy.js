// German error-pattern taxonomy for the error ledger.
//
// Codes are the stable identity of a pattern: they key ledger entries,
// ride through the feedback engine's structured output (as an enum), and
// appear on rung 3 of the ladder as Hartshorn-style indirect codes.
//
// `stage` is the Processability Theory stage (Pienemann's German word-order
// sequence) where the structure becomes learnable; null = not stage-bound
// (rule-governed morphology is learnable at any point). `treatable` marks
// rule-governed patterns (Ferris) where metalinguistic feedback pays off;
// untreatable buckets (word choice) are better served by model-text work.

export const TAXONOMY = [
  // --- Word order (Processability-anchored) ---
  { code: 'WO-V2',   name: 'Verb-second in main clauses',           group: 'Word order', stage: 4, treatable: true,
    hint: 'finite verb must be the second constituent, incl. after a fronted adverbial ("Gestern habe ich…")' },
  { code: 'WO-SEP',  name: 'Separable-verb split',                  group: 'Word order', stage: 3, treatable: true,
    hint: 'separable prefix moves to clause end ("Ich rufe dich morgen an")' },
  { code: 'WO-VF',   name: 'Verb-final in subordinate clauses',     group: 'Word order', stage: 5, treatable: true,
    hint: 'finite verb at the end after weil/dass/wenn/ob/relative clauses' },
  { code: 'WO-KLAM', name: 'Verbal bracket (Satzklammer)',          group: 'Word order', stage: 3, treatable: true,
    hint: 'participle/infinitive at clause end with haben/sein/werden/modals' },
  { code: 'WO-TMP',  name: 'Time–manner–place ordering',            group: 'Word order', stage: null, treatable: true,
    hint: 'adverbial ordering: temporal before manner before place' },

  // --- Case ---
  { code: 'KAS-AKK',  name: 'Accusative for direct objects',        group: 'Case', stage: null, treatable: true,
    hint: 'direct object takes accusative ("Ich sehe den Mann")' },
  { code: 'KAS-DAT',  name: 'Dative objects & dative verbs',        group: 'Case', stage: null, treatable: true,
    hint: 'indirect objects and verbs like helfen/danken/gefallen take dative' },
  { code: 'KAS-GEN',  name: 'Genitive',                             group: 'Case', stage: null, treatable: true,
    hint: 'possession and genitive prepositions (wegen, trotz, während)' },
  { code: 'KAS-PREP', name: 'Case after fixed-case prepositions',   group: 'Case', stage: null, treatable: true,
    hint: 'mit/aus/bei/nach/von/zu → dative; für/ohne/gegen/durch/um → accusative' },
  { code: 'KAS-2WEG', name: 'Two-way prepositions',                 group: 'Case', stage: null, treatable: true,
    hint: 'an/auf/in/über/unter…: accusative for motion, dative for location' },

  // --- Agreement & morphology ---
  { code: 'ADJ-END', name: 'Adjective endings',                     group: 'Agreement', stage: null, treatable: true,
    hint: 'declension after der-words, ein-words, and bare nouns' },
  { code: 'ART-GEN', name: 'Article–gender agreement',              group: 'Agreement', stage: null, treatable: true,
    hint: 'article/determiner must match the noun’s gender (the gender itself is lexical; the agreement is grammar)' },
  { code: 'N-PL',    name: 'Plural formation',                      group: 'Agreement', stage: null, treatable: true,
    hint: 'wrong or missing plural form' },
  { code: 'PRO-REL', name: 'Relative pronouns',                     group: 'Agreement', stage: 5, treatable: true,
    hint: 'relative pronoun agrees in gender/number with antecedent, case from its own clause' },
  { code: 'PRO-KAS', name: 'Personal-pronoun case/reference',       group: 'Agreement', stage: null, treatable: true,
    hint: 'mir/mich, ihm/ihn confusion; unclear pronoun reference' },

  // --- Verbs ---
  { code: 'V-KONJ', name: 'Subject–verb agreement / conjugation',   group: 'Verbs', stage: null, treatable: true,
    hint: 'person/number endings, irregular present-tense stems (du fährst, er liest)' },
  { code: 'V-TEMP', name: 'Tense choice & formation',               group: 'Verbs', stage: null, treatable: true,
    hint: 'Perfekt vs. Präteritum, haben vs. sein auxiliary, future with werden' },
  { code: 'V-PART', name: 'Participle formation',                   group: 'Verbs', stage: null, treatable: true,
    hint: 'ge- placement, strong vs. weak participles (gegangen, gearbeitet, verstanden)' },
  { code: 'V-K2',   name: 'Konjunktiv II',                          group: 'Verbs', stage: null, treatable: true,
    hint: 'hypotheticals and polite forms: würde + infinitive, hätte/wäre/könnte' },
  { code: 'V-REFL', name: 'Reflexive verbs',                        group: 'Verbs', stage: null, treatable: true,
    hint: 'missing/wrong reflexive pronoun (sich freuen auf, sich erinnern an)' },

  // --- Other ---
  { code: 'PREP-W', name: 'Preposition choice',                     group: 'Other', stage: null, treatable: true,
    hint: 'wrong preposition for the verb/noun (warten auf, Angst vor)' },
  { code: 'ORTH',   name: 'Spelling & capitalization',              group: 'Other', stage: null, treatable: true,
    hint: 'noun capitalization, umlauts, ß/ss' },
  { code: 'WORTW',  name: 'Word choice / idiomaticity',             group: 'Other', stage: null, treatable: false,
    hint: 'grammatical but unidiomatic — a German speaker would phrase it differently' },
  { code: 'SONST',  name: 'Other',                                  group: 'Other', stage: null, treatable: false,
    hint: 'anything not covered by another code' },
]

export const CODE_SET = new Set(TAXONOMY.map((p) => p.code))

export function patternFor(code) {
  return TAXONOMY.find((p) => p.code === code) || null
}

// Compact taxonomy listing for the feedback engine's system prompt.
export function taxonomyPromptBlock() {
  return TAXONOMY.map((p) => `${p.code} — ${p.name}: ${p.hint}`).join('\n')
}
