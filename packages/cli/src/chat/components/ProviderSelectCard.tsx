import { SelectCard, type SelectItem } from '@tejika/ui'

const PROVIDERS: Array<SelectItem> = [
  { label: 'ollama', value: 'ollama' },
  { label: 'openai', value: 'openai' },
  { label: 'anthropic', value: 'anthropic' },
  { label: 'llama', value: 'llama' },
]

export type ProviderSelectCardProps = {
  onSelect: (provider: string) => void
  onCancel: () => void
}

export function ProviderSelectCard({ onSelect, onCancel }: ProviderSelectCardProps) {
  return (
    <SelectCard
      title="select a provider"
      items={PROVIDERS}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  )
}
