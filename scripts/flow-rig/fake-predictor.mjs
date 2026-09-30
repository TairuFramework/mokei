/**
 * Scripted predictor for running decision flows without a System One server.
 * A plain object (not a factory) so flow plans exclude `system-one:predict`.
 */
export function createFakePredictor(fakeAnswers) {
  return {
    async predict(params) {
      params.signal?.throwIfAborted()
      const answers = {}
      for (const key of Object.keys(params.questions)) {
        if (!Object.hasOwn(fakeAnswers, key)) {
          throw new Error(`No fake answer for ${key}`)
        }
        answers[key] = fakeAnswers[key]
      }
      return { model: 'fake', answers, usage: { inputTokens: 0, outputTokens: 0 } }
    },
  }
}
