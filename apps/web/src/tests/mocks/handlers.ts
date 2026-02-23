import { http, HttpResponse } from 'msw'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321'

// Handlers MSW — simulam as respostas do Supabase REST API
// Adicione novos handlers aqui conforme necessário nos testes
export const handlers = [
  // Exemplo: mock da tabela notas_manutencao
  http.get(`${SUPABASE_URL}/rest/v1/notas_manutencao`, () => {
    return HttpResponse.json([])
  }),

  // Exemplo: mock da tabela administradores
  http.get(`${SUPABASE_URL}/rest/v1/administradores`, () => {
    return HttpResponse.json([])
  }),
]
