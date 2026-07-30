import { describe, it, expect } from 'vitest'
import { parseJsonText } from '../jsonText'

// The fallback provider gets no schema enforcement, so this parser is the only
// thing standing between a chatty model and a crashed session.
describe('parseJsonText', () => {
  it('parses a bare object', () => {
    expect(parseJsonText('{"clean": true, "errors": []}')).toEqual({ clean: true, errors: [] })
  })

  it('unwraps a ```json fence', () => {
    const raw = '```json\n{"task": "Write to Jonas.", "requirements": []}\n```'
    expect(parseJsonText(raw).task).toBe('Write to Jonas.')
  })

  it('unwraps a bare fence', () => {
    expect(parseJsonText('```\n{"a": 1}\n```')).toEqual({ a: 1 })
  })

  it('strips prose padding around the object', () => {
    const raw = 'Sure! Here is the analysis:\n{"clean": false, "praise": ""}\nLet me know if you need more.'
    expect(parseJsonText(raw)).toEqual({ clean: false, praise: '' })
  })

  it('survives nested braces', () => {
    const raw = 'Result: {"errors": [{"quote": "an die Wand", "pattern_code": "KAS-2WEG"}]}'
    expect(parseJsonText(raw).errors[0].pattern_code).toBe('KAS-2WEG')
  })

  it('throws a clear error when there is no object at all', () => {
    expect(() => parseJsonText('I cannot help with that.')).toThrow(/no JSON object/)
  })
})
