export type Verdict = 'right' | 'wrong'

export type Assumption = {
  id: string
  text: string
  verdict: Verdict | null
  note: string
}

export type AssumptionSet = {
  turnId: string
  status: 'collecting' | 'ready' | 'reviewed'
  items: Assumption[]
}

declare module 'claude-code' {
  interface PluginState {
    'assumption-tracker': {
      current: AssumptionSet | null
      focused: string | null
    }
  }
}
