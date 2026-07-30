// Meaningful micro-writing prompts (Focus on Form: meaning first, the
// grammar target hides inside the communicative task). Each prompt is
// tagged with the pattern codes it tends to *obligate*, so prompt selection
// can be silently biased toward the gardener's active targets.

export const PROMPTS = [
  { id: 'late',        text: 'Explain to a friend why you were late to something this week — give at least two reasons.', tags: ['WO-VF', 'V-TEMP'] },
  { id: 'yesterday',   text: 'Describe what you did yesterday, from morning to evening.', tags: ['V-TEMP', 'WO-KLAM', 'WO-V2'] },
  { id: 'weekend',     text: 'Write a short message to a friend proposing a plan for next weekend.', tags: ['WO-SEP', 'WO-V2'] },
  { id: 'opinion-pets', text: 'Give your opinion: should dogs be allowed in restaurants? Justify it, and mention one cat who would disagree.', tags: ['WO-VF', 'ADJ-END'] },
  { id: 'apartment',   text: 'Describe your apartment or room — what is where, and what you like about it.', tags: ['KAS-2WEG', 'ADJ-END', 'ART-GEN'] },
  { id: 'commute',     text: 'Describe your commute or a typical journey: when, how, and where you go.', tags: ['WO-TMP', 'KAS-PREP'] },
  { id: 'neighbour',   text: 'Write a polite but firm note to the neighbour whose cat keeps stealing your socks.', tags: ['V-K2', 'WO-VF'] },
  { id: 'lottery',     text: 'What would you do if you won a large amount of money? Three things.', tags: ['V-K2', 'WO-VF'] },
  { id: 'childhood',   text: 'Describe something you often did as a child that you no longer do.', tags: ['V-TEMP', 'WO-V2'] },
  { id: 'recipe',      text: 'Explain how to prepare a dish you know well, step by step.', tags: ['WO-SEP', 'KAS-AKK', 'WO-V2'] },
  { id: 'complaint',   text: 'Write a complaint about a product or service that disappointed you.', tags: ['WO-VF', 'V-TEMP', 'ADJ-END'] },
  { id: 'help',        text: 'Describe a time you helped someone, or someone helped you.', tags: ['KAS-DAT', 'V-TEMP'] },
  { id: 'book-film',   text: 'Recommend a book or film to a friend and explain why they would like it.', tags: ['PRO-REL', 'ADJ-END'] },
  { id: 'city',        text: 'Describe a city you love: what one should see, eat, and avoid there.', tags: ['ADJ-END', 'KAS-2WEG'] },
  { id: 'morning',     text: 'Describe your morning routine — when you get up, what happens in what order.', tags: ['WO-SEP', 'V-REFL', 'WO-TMP'] },
  { id: 'plans',       text: 'What are your plans for the next year? Work, learning, travel.', tags: ['V-TEMP', 'WO-V2'] },
  { id: 'weather-plan',text: 'Write what you will do tomorrow depending on the weather (if it rains…, if it is sunny…).', tags: ['WO-VF', 'WO-V2'] },
  { id: 'character',   text: 'Describe someone in your neighbourhood everyone knows: appearance, manner, and one story about them.', tags: ['ADJ-END', 'PRO-REL'] },
  { id: 'explain-game',text: 'Explain the rules of a game you know well to someone who has never played it.', tags: ['WO-VF', 'PRO-REL'] },
  { id: 'mistake',     text: 'Describe a mistake you once made and what you learned from it.', tags: ['V-TEMP', 'V-REFL', 'WO-VF'] },
  { id: 'invite',      text: 'Invite a friend to your place: when they should come, what you will do, what they should bring.', tags: ['WO-SEP', 'KAS-AKK', 'V-K2'] },
  { id: 'compare',     text: 'Compare living in a big city with living in the countryside.', tags: ['ADJ-END', 'WO-V2'] },
  { id: 'lost',        text: 'Tell the story of a time you lost something or got lost.', tags: ['V-TEMP', 'WO-KLAM', 'KAS-2WEG'] },
  { id: 'dream-job',   text: 'If you had to run a small shop or stall of any kind, what would you sell and why?', tags: ['V-K2', 'WO-VF'] },
  { id: 'parcel',      text: 'Your parcel was delivered to the wrong address three times. Write to the delivery company.', tags: ['WO-VF', 'V-TEMP', 'KAS-DAT'] },
  { id: 'cake',        text: 'Describe, with more drama than the situation deserves, a cake that went badly wrong.', tags: ['V-TEMP', 'ADJ-END', 'WO-KLAM'] },
]

// Pick a prompt, preferring ones that obligate at least one active target
// (the bias is silent — the writer just sees a communicative task). The
// `exclude` list keeps recently used prompts out of rotation.
export function pickPrompt({ activeTargets = [], exclude = [], random = Math.random } = {}) {
  const fresh = PROMPTS.filter((p) => !exclude.includes(p.id))
  const pool = fresh.length ? fresh : PROMPTS
  if (activeTargets.length) {
    const targeted = pool.filter((p) => p.tags.some((t) => activeTargets.includes(t)))
    if (targeted.length) return targeted[Math.floor(random() * targeted.length)]
  }
  return pool[Math.floor(random() * pool.length)]
}
