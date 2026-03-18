-- 00171_exclui_cockpit_from_painel_notas.sql
--
-- Exclui notas com exclui_cockpit=true do painel de notas (vw_notas_sem_ordem).
-- Notas de RECARGA DE EXTINTOR não aparecem mais no painel de distribuição.

CREATE OR REPLACE VIEW public.vw_notas_sem_ordem AS
SELECT
  id,
  numero_nota,
  tipo_nota,
  descricao,
  descricao_objeto,
  prioridade,
  tipo_prioridade,
  criado_por_sap,
  solicitante,
  data_criacao_sap,
  data_nota,
  hora_nota,
  ordem_sap,
  centro,
  status_sap,
  conta_fornecedor,
  autor_nota,
  streaming_timestamp,
  status,
  administrador_id,
  distribuida_em,
  ordem_gerada,
  fornecedor_encaminhado,
  observacoes,
  sync_id,
  raw_data,
  created_at,
  updated_at
FROM public.notas_manutencao n
WHERE status = ANY (
    ARRAY[
      'nova'::public.nota_status,
      'em_andamento'::public.nota_status,
      'encaminhada_fornecedor'::public.nota_status
    ]
  )
  AND n.exclui_cockpit = false
  AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
  AND NOT EXISTS (
    SELECT 1
    FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id = n.id
      AND public.status_raw_eh_ativo(o.status_ordem_raw)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id IS NULL
      AND COALESCE(NULLIF(LTRIM(BTRIM(o.numero_nota), '0'), ''), '0')
        = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
      AND public.status_raw_eh_ativo(o.status_ordem_raw)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.notas_status_sap_aux aux
    WHERE aux.numero_nota_norm
      = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
      AND aux.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
  );
