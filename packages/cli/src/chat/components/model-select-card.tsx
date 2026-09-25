import { SelectCard } from '@tejika/ui'

export type ModelOption = { id: string }

export type ModelSelectCardProps = {
  models: Array<ModelOption>
  provider: string
  onSelect: (id: string) => void
  onCancel: () => void
}

export function ModelSelectCard({ models, provider, onSelect, onCancel }: ModelSelectCardProps) {
  return (
    <SelectCard
      title="select a model"
      items={models.map((model) => ({ label: model.id, value: model.id }))}
      onSelect={onSelect}
      onCancel={onCancel}
      emptyMessage={`no models available from ${provider} — check the provider is reachable (--api-url) and has models`}
    />
  )
}
