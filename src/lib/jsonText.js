// Recovering a JSON object from a model's text response.
//
// The Anthropic path uses schema-enforced structured output and comes back
// clean, but the server's fallback provider has no schema enforcement — the
// gateways don't proxy output_config — so its JSON shape is spelled out in the
// prompt and may arrive wrapped in a markdown fence or padded with a sentence.
// This is the only thing standing between a chatty model and a crashed session.

export function parseJsonText(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('Model response contained no JSON object.')
  }
  return JSON.parse(candidate.slice(start, end + 1))
}
