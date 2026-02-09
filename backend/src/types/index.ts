// Nota vinda do Databricks (SAP)
export interface NotaDatabricks {
  NUMERO_NOTA: string;
  TIPO_NOTA: string | null;
  TEXTO_BREVE: string | null;
  TIPO_PRIORIDADE: string | null;
  PRIORIDADE: string | null;
  CRIADO_POR: string | null;
  DATA_CRIACAO: string | null;
  CENTRO_MATERIAL: string | null;
  // Todos os outros campos ficam em dados_originais
  [key: string]: unknown;
}

// Demanda no Supabase
export interface Demanda {
  id: string;
  numero_nota: string;
  tipo_nota: string | null;
  texto_breve: string | null;
  prioridade: string | null;
  tipo_prioridade: string | null;
  centro_material: string | null;
  criado_por: string | null;
  data_criacao_sap: string | null;
  status: 'nova' | 'em_andamento' | 'encaminhada' | 'concluida' | 'cancelada';
  admin_id: string | null;
  atribuido_em: string | null;
  dados_originais: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Admin
export interface Admin {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  peso: number;
  limite_max: number;
  created_at: string;
  updated_at: string;
}

// Carga do admin (view)
export interface CargaAdmin {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  peso: number;
  limite_max: number;
  carga_atual: number;
  qtd_nova: number;
  qtd_em_andamento: number;
  qtd_encaminhada: number;
  qtd_concluida: number;
  ultima_atribuicao: string | null;
}

// Log de execucao
export interface LogExecucao {
  id: string;
  executado_em: string;
  qtd_novas: number;
  qtd_atribuidas: number;
  erros: string | null;
  watermark: string | null;
  duracao_ms: number | null;
}

// Resultado do sync
export interface SyncResult {
  success: boolean;
  qtdNovas: number;
  qtdAtribuidas: number;
  erros: string[];
  duracaoMs: number;
}
