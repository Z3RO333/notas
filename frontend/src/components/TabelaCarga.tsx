import { CargaAdmin } from '../lib/supabase';

interface TabelaCargaProps {
  admins: CargaAdmin[];
}

export function TabelaCarga({ admins }: TabelaCargaProps) {
  // Ordena por carga (maior primeiro)
  const sorted = [...admins].sort((a, b) => b.carga_atual - a.carga_atual);

  // Calcula total
  const total = admins.reduce(
    (acc, admin) => ({
      carga: acc.carga + admin.carga_atual,
      nova: acc.nova + admin.qtd_nova,
      andamento: acc.andamento + admin.qtd_em_andamento,
      encaminhada: acc.encaminhada + admin.qtd_encaminhada,
      concluida: acc.concluida + admin.qtd_concluida,
    }),
    { carga: 0, nova: 0, andamento: 0, encaminhada: 0, concluida: 0 }
  );

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Admin
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
              Carga
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium text-blue-500 uppercase">
              Novas
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium text-yellow-500 uppercase">
              Andamento
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium text-purple-500 uppercase">
              Encaminhadas
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium text-green-500 uppercase">
              Concluidas
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {sorted.map((admin) => (
            <tr key={admin.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 whitespace-nowrap">
                <div className="text-sm font-medium text-gray-900">{admin.nome}</div>
                <div className="text-xs text-gray-500">{admin.email}</div>
              </td>
              <td className="px-4 py-3 text-center">
                <span
                  className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                    admin.carga_atual === 0
                      ? 'bg-gray-100 text-gray-600'
                      : admin.carga_atual < 5
                      ? 'bg-green-100 text-green-800'
                      : admin.carga_atual < 10
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {admin.carga_atual}
                </span>
              </td>
              <td className="px-4 py-3 text-center text-sm text-blue-600">
                {admin.qtd_nova}
              </td>
              <td className="px-4 py-3 text-center text-sm text-yellow-600">
                {admin.qtd_em_andamento}
              </td>
              <td className="px-4 py-3 text-center text-sm text-purple-600">
                {admin.qtd_encaminhada}
              </td>
              <td className="px-4 py-3 text-center text-sm text-green-600">
                {admin.qtd_concluida}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50">
          <tr>
            <td className="px-4 py-3 text-sm font-bold text-gray-900">TOTAL</td>
            <td className="px-4 py-3 text-center text-sm font-bold">{total.carga}</td>
            <td className="px-4 py-3 text-center text-sm font-bold text-blue-600">
              {total.nova}
            </td>
            <td className="px-4 py-3 text-center text-sm font-bold text-yellow-600">
              {total.andamento}
            </td>
            <td className="px-4 py-3 text-center text-sm font-bold text-purple-600">
              {total.encaminhada}
            </td>
            <td className="px-4 py-3 text-center text-sm font-bold text-green-600">
              {total.concluida}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
