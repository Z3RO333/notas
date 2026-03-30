-- 00205_seed_ordens_tv_viewer_account.sql
--
-- Prepara a conta dedicada da TV de ordens para usar o novo papel viewer.
-- Esta migration deve rodar depois da 00204, quando o enum user_role ja foi
-- commitado com o valor "viewer".

INSERT INTO public.administradores (
  nome,
  email,
  role,
  ativo,
  max_notas,
  especialidade,
  recebe_distribuicao,
  em_ferias,
  motivo_bloqueio
)
VALUES (
  'Ordens Manutencao',
  'ordensmanutencao@bemol.com.br',
  'viewer',
  TRUE,
  0,
  'geral',
  FALSE,
  FALSE,
  'Conta viewer somente leitura para transmissao do painel de ordens.'
)
ON CONFLICT (email) DO UPDATE
SET
  role = 'viewer',
  ativo = TRUE,
  max_notas = 0,
  recebe_distribuicao = FALSE,
  em_ferias = FALSE,
  motivo_bloqueio = 'Conta viewer somente leitura para transmissao do painel de ordens.',
  updated_at = now();
