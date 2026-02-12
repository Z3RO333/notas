interface GridEmptyStateProps {
  message?: string
}

export function GridEmptyState({ message = 'Nenhum registro encontrado.' }: GridEmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}
