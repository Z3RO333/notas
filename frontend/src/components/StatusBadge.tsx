interface StatusBadgeProps {
  status: string;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  nova: {
    label: 'Nova',
    className: 'bg-blue-100 text-blue-800',
  },
  em_andamento: {
    label: 'Em Andamento',
    className: 'bg-yellow-100 text-yellow-800',
  },
  encaminhada: {
    label: 'Encaminhada',
    className: 'bg-purple-100 text-purple-800',
  },
  concluida: {
    label: 'Concluida',
    className: 'bg-green-100 text-green-800',
  },
  cancelada: {
    label: 'Cancelada',
    className: 'bg-gray-100 text-gray-800',
  },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] || {
    label: status,
    className: 'bg-gray-100 text-gray-800',
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}
