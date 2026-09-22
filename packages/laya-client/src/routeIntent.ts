import type { LayaClient } from './client.js'
import type { ChoiceQuestion, State } from './types.js'

export type IntentRoute = {
  label: string
  confidence: number
  model: string
}

export type RouteIntentParams = {
  client: LayaClient
  state: State
  question: ChoiceQuestion
  model?: string
  signal?: AbortSignal
}

export async function routeIntent(params: RouteIntentParams): Promise<IntentRoute> {
  const result = await params.client.predict({
    state: params.state,
    questions: { intent: params.question },
    model: params.model,
    signal: params.signal,
  })
  const answer = result.answers.intent
  return { label: answer.choice, confidence: answer.confidence, model: result.model }
}
