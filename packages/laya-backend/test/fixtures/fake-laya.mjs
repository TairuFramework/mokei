#!/usr/bin/env node
// Stand-in for `laya daemon` in unit tests, speaking the same newline JSON protocol: a ready
// line, then one response per request line, in request order.
//
// FAKE_LAYA_START picks startup behavior: 'ok' (default), 'fail' (stderr text, exit 1) or
// 'hang' (never ready). A request's `state` string picks its behavior: 'error',
// 'error-no-id', 'invalid', 'crash', 'slow:<ms>'; any other state gets a normal result whose
// `route` echoes the state.
import { createInterface } from 'node:readline'

const start = process.env.FAKE_LAYA_START ?? 'ok'

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function answerFor(question) {
  const action = { act_probability: 0.5 }
  if (question.type === 'choice') {
    const keys = Object.keys(question.criteria)
    const probabilities = Object.fromEntries(keys.map((key, i) => [key, i === 0 ? 1 : 0]))
    return { type: 'choice', choice: keys[0], confidence: 1, probabilities, action }
  }
  if (question.type === 'score') {
    const legend = Object.fromEntries(question.criteria.map((level, i) => [String(i), level]))
    const probabilities = Object.fromEntries(
      question.criteria.map((_, i) => [String(i), i === 0 ? 1 : 0]),
    )
    return { type: 'score', score: 0, confidence: 1, legend, probabilities, action }
  }
  return { type: 'noul', noul: 0.5, confidence: 0.5, action }
}

if (start === 'fail') {
  process.stderr.write('failed to load missing.gguf\n')
  process.exit(1)
}
if (start === 'hang') {
  process.stderr.write(`loading model (pid ${process.pid})\n`)
  setInterval(() => {}, 1000)
} else {
  write({ status: 'ready', model: 'laya' })
}

for await (const line of createInterface({ input: process.stdin })) {
  if (start === 'hang' || line === '') continue
  const { id, state, questions } = JSON.parse(line)
  if (state === 'error') {
    write({ id, error: 'missing questions' })
    continue
  }
  if (state === 'error-no-id') {
    write({ error: 'bad line' })
    continue
  }
  if (state === 'invalid') {
    process.stdout.write('not json\n')
    continue
  }
  if (state === 'crash') {
    process.stderr.write('decide failed\n')
    process.exit(3)
  }
  if (typeof state === 'string' && state.startsWith('slow:')) {
    await new Promise((resolve) => setTimeout(resolve, Number(state.slice(5))))
  }
  const answers = Object.fromEntries(
    Object.entries(questions).map(([key, question]) => [key, answerFor(question)]),
  )
  write({
    model: 'laya',
    family: 'english',
    route: typeof state === 'string' ? state : 'object',
    pid: process.pid,
    argv: process.argv.slice(2),
    answers,
    usage: { input_tokens: 3, output_tokens: 0, latency_ms: 1 },
    id,
  })
}
