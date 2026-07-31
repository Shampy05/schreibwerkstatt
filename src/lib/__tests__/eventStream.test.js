import { describe, it, expect } from 'vitest'
import { readEventStream } from '../engine'

// A Response-alike whose body yields exactly the chunks given, so the tests can
// control where the byte boundaries fall — that is the whole risk in this code.
function streamOf(chunks) {
  const encoder = new TextEncoder()
  let i = 0
  return {
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true },
        cancel: async () => {},
      }),
    },
  }
}

const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`

describe('readEventStream', () => {
  it('returns the payload frame', async () => {
    const res = streamOf([frame({ content: '{"clean":true}', via: 'glm-5.2' })])
    expect(await readEventStream(res)).toEqual({ content: '{"clean":true}', via: 'glm-5.2' })
  })

  it('skips heartbeat comments, however many arrive first', async () => {
    const res = streamOf([': open\n\n', ': waiting\n\n', ': waiting\n\n', frame({ content: 'x' })])
    expect(await readEventStream(res)).toEqual({ content: 'x' })
  })

  it('reassembles a frame split across chunks — a payload is not one packet', async () => {
    const whole = frame({ content: 'a long analysis', via: 'glm-5.2' })
    const cut = Math.floor(whole.length / 2)
    const res = streamOf([': open\n\n', whole.slice(0, cut), whole.slice(cut)])
    expect(await readEventStream(res)).toEqual({ content: 'a long analysis', via: 'glm-5.2' })
  })

  it('handles a heartbeat and the payload arriving in one chunk', async () => {
    const res = streamOf([`: waiting\n\n${frame({ content: 'x' })}`])
    expect(await readEventStream(res)).toEqual({ content: 'x' })
  })

  it('survives a frame boundary landing between the two newlines', async () => {
    const whole = frame({ content: 'x' })
    const res = streamOf([whole.slice(0, whole.length - 1), whole.slice(-1)])
    expect(await readEventStream(res)).toEqual({ content: 'x' })
  })

  it('passes an error frame through for the caller to raise', async () => {
    const res = streamOf([frame({ error: 'glm-5.2 did not respond within 110s' })])
    expect(await readEventStream(res)).toEqual({ error: 'glm-5.2 did not respond within 110s' })
  })

  it('names a dropped connection instead of a generic parse failure', async () => {
    // Heartbeats then nothing: the isolate died mid-analysis. Previously this
    // surfaced as a null-status CORS error, which reads like a config problem.
    await expect(readEventStream(streamOf([': open\n\n', ': waiting\n\n']))).rejects.toThrow(
      /connection dropped/
    )
  })

  it('rejects a malformed frame rather than returning undefined', async () => {
    await expect(readEventStream(streamOf(['data: {not json\n\n']))).rejects.toThrow(/malformed/)
  })

  it('rejects a response with no body at all', async () => {
    await expect(readEventStream({ body: null })).rejects.toThrow(/empty response/)
  })
})
