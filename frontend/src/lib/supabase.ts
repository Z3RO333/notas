import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY sao obrigatorios');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types
export interface Admin {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  peso: number;
  limite_max: number;
}

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
  created_at: string;
  updated_at: string;
}

export interface CargaAdmin {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  carga_atual: number;
  qtd_nova: number;
  qtd_em_andamento: number;
  qtd_encaminhada: number;
  qtd_concluida: number;
}
