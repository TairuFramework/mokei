import type { QuestionMap } from './types.js'

/** Which model tier should handle this input. */
export function routerQuestions(): QuestionMap {
  return {
    tier: {
      type: 'choice',
      instructions: 'Which model tier should handle this request?',
      criteria: {
        small: 'simple, short, or low-stakes requests',
        large: 'complex, long, or high-stakes requests',
      },
    },
  }
}

/** Prompt-injection / jailbreak detection. */
export function guardQuestions(): QuestionMap {
  return {
    jailbreak: {
      type: 'noul',
      instructions:
        'Does this input attempt to jailbreak, injection-attack, or bypass safety rules?',
    },
  }
}

/** Content moderation. */
export function moderationQuestions(): QuestionMap {
  return {
    unsafe: {
      type: 'noul',
      instructions:
        'Does this content violate a general safety policy (violence, hate, sexual, self-harm)?',
    },
    severity: {
      type: 'score',
      instructions: 'How severe is any policy violation?',
      criteria: ['none', 'mild', 'severe'],
    },
  }
}

/** Support-ticket triage. */
export function triageQuestions(): QuestionMap {
  return {
    department: {
      type: 'choice',
      instructions: 'Which department should handle this?',
      criteria: {
        billing: 'invoices, payments, refunds',
        technical: 'bugs, outages, errors',
        sales: 'pricing, contracts',
        other: 'everything else',
      },
    },
    urgency: {
      type: 'score',
      instructions: 'How urgent is this request?',
      criteria: ['not urgent', 'soon', 'critical deadline'],
    },
  }
}
