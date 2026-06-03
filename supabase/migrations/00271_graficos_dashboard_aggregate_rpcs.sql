-- 00271_graficos_dashboard_aggregate_rpcs.sql
--
-- Reduz fan-out no Next.js para /admin/graficos.
-- As RPCs abaixo preservam a semantica existente porque apenas agregam, em um
-- unico contrato JSONB, os resultados das RPCs canonicas ja usadas pela tela.

CREATE OR REPLACE FUNCTION public.buscar_graficos_gestao_agregado(
  p_ano         INTEGER DEFAULT NULL,
  p_mes         INTEGER DEFAULT NULL,
  p_tipo_ordem  TEXT DEFAULT NULL,
  p_nome_loja   TEXT DEFAULT NULL,
  p_texto_breve TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'topLojas', COALESCE((
      SELECT jsonb_agg(to_jsonb(row))
      FROM public.calcular_gestao_top_lojas_por_status(
        p_ano,
        p_mes,
        p_tipo_ordem,
        p_nome_loja,
        p_texto_breve
      ) row
    ), '[]'::JSONB),
    'topServicos', COALESCE((
      SELECT jsonb_agg(to_jsonb(row))
      FROM public.calcular_gestao_top_servicos(
        p_ano,
        p_mes,
        p_tipo_ordem,
        p_nome_loja,
        p_texto_breve
      ) row
    ), '[]'::JSONB),
    'evolucao', COALESCE((
      SELECT jsonb_agg(to_jsonb(row))
      FROM public.calcular_gestao_evolucao_mensal(
        p_ano,
        p_tipo_ordem,
        p_nome_loja,
        p_texto_breve
      ) row
    ), '[]'::JSONB),
    'segmentos', COALESCE((
      SELECT jsonb_agg(to_jsonb(row))
      FROM public.calcular_gestao_resumo_segmentos(
        p_ano,
        p_mes,
        p_tipo_ordem,
        p_nome_loja,
        p_texto_breve
      ) row
    ), '[]'::JSONB),
    'opcoes', COALESCE((
      SELECT jsonb_agg(to_jsonb(row))
      FROM public.listar_gestao_filtros() row
    ), '[]'::JSONB)
  );
$$;

CREATE OR REPLACE FUNCTION public.buscar_graficos_indicadores_agregado(
  p_start_iso         TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_admin_id          UUID DEFAULT NULL,
  p_include_colaboradores BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'kpis', COALESCE(
      to_jsonb(public.calcular_kpis_notas_ordens(
        p_start_iso,
        p_end_exclusive_iso,
        p_admin_id
      )),
      '{}'::JSONB
    ),
    'resumoDiario', COALESCE((
      SELECT jsonb_agg(to_jsonb(row))
      FROM public.calcular_resumo_diario_notas_ordens(
        p_start_iso,
        p_end_exclusive_iso,
        p_admin_id
      ) row
    ), '[]'::JSONB),
    'lojas', COALESCE((
      SELECT jsonb_agg(to_jsonb(row))
      FROM public.calcular_indicadores_por_loja_notas(
        p_start_iso,
        p_end_exclusive_iso,
        p_admin_id
      ) row
    ), '[]'::JSONB),
    'colaboradores', CASE
      WHEN p_include_colaboradores THEN COALESCE((
        SELECT jsonb_agg(to_jsonb(row))
        FROM public.calcular_indicadores_por_colaborador(
          p_start_iso,
          p_end_exclusive_iso
        ) row
      ), '[]'::JSONB)
      ELSE '[]'::JSONB
    END,
    'lojasOrdens', COALESCE((
      SELECT jsonb_agg(to_jsonb(row))
      FROM public.calcular_indicadores_por_loja_ordens(
        p_start_iso,
        p_end_exclusive_iso,
        p_admin_id
      ) row
    ), '[]'::JSONB),
    'colaboradoresOrdens', CASE
      WHEN p_include_colaboradores THEN COALESCE((
        SELECT jsonb_agg(to_jsonb(row))
        FROM public.calcular_indicadores_por_colaborador_ordens(
          p_start_iso,
          p_end_exclusive_iso,
          p_admin_id
        ) row
      ), '[]'::JSONB)
      ELSE '[]'::JSONB
    END
  );
$$;

GRANT EXECUTE ON FUNCTION public.buscar_graficos_gestao_agregado(INTEGER, INTEGER, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_graficos_indicadores_agregado(TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN) TO authenticated;
