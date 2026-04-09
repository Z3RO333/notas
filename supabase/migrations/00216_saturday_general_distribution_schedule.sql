-- 00216_saturday_general_distribution_schedule.sql
--
-- Adiciona configuracao mensal de escala de sabado para o pool geral de notas.
-- A regra vale somente para notas novas distribuidas no sabado corrente, da 00:00
-- ate o horario final configurado no fuso de Manaus.

CREATE TABLE IF NOT EXISTS public.escala_distribuicao_sabado (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_escala DATE NOT NULL,
  hora_fim TIME NOT NULL,
  atualizado_por UUID REFERENCES public.administradores(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_escala_distribuicao_sabado_data UNIQUE (data_escala),
  CONSTRAINT chk_escala_distribuicao_sabado_data_sabado
    CHECK (EXTRACT(DOW FROM data_escala) = 6)
);

CREATE TABLE IF NOT EXISTS public.escala_distribuicao_sabado_participantes (
  escala_id UUID NOT NULL REFERENCES public.escala_distribuicao_sabado(id) ON DELETE CASCADE,
  administrador_id UUID NOT NULL REFERENCES public.administradores(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (escala_id, administrador_id)
);

CREATE INDEX IF NOT EXISTS idx_escala_distribuicao_sabado_data
  ON public.escala_distribuicao_sabado (data_escala);

CREATE INDEX IF NOT EXISTS idx_escala_distribuicao_sabado_participantes_admin
  ON public.escala_distribuicao_sabado_participantes (administrador_id);

DROP TRIGGER IF EXISTS trg_escala_distribuicao_sabado_updated ON public.escala_distribuicao_sabado;
CREATE TRIGGER trg_escala_distribuicao_sabado_updated
  BEFORE UPDATE ON public.escala_distribuicao_sabado
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.validar_participante_escala_distribuicao_sabado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role user_role;
  v_especialidade TEXT;
BEGIN
  SELECT role, especialidade
    INTO v_role, v_especialidade
  FROM public.administradores
  WHERE id = NEW.administrador_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administrador da escala de sabado nao encontrado: %', NEW.administrador_id;
  END IF;

  IF v_role <> 'admin' OR COALESCE(v_especialidade, '') <> 'geral' THEN
    RAISE EXCEPTION 'Escala de sabado aceita apenas administradores do pool geral';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_participante_escala_distribuicao_sabado
  ON public.escala_distribuicao_sabado_participantes;
CREATE TRIGGER trg_validar_participante_escala_distribuicao_sabado
  BEFORE INSERT OR UPDATE ON public.escala_distribuicao_sabado_participantes
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_participante_escala_distribuicao_sabado();

ALTER TABLE public.escala_distribuicao_sabado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escala_distribuicao_sabado_participantes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticado le escala_distribuicao_sabado" ON public.escala_distribuicao_sabado;
CREATE POLICY "Autenticado le escala_distribuicao_sabado"
  ON public.escala_distribuicao_sabado
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Gestor escreve escala_distribuicao_sabado" ON public.escala_distribuicao_sabado;
CREATE POLICY "Gestor escreve escala_distribuicao_sabado"
  ON public.escala_distribuicao_sabado
  FOR ALL
  TO authenticated
  USING (public.get_my_role() = 'gestor')
  WITH CHECK (public.get_my_role() = 'gestor');

DROP POLICY IF EXISTS "Autenticado le escala_distribuicao_sabado_participantes" ON public.escala_distribuicao_sabado_participantes;
CREATE POLICY "Autenticado le escala_distribuicao_sabado_participantes"
  ON public.escala_distribuicao_sabado_participantes
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Gestor escreve escala_distribuicao_sabado_participantes" ON public.escala_distribuicao_sabado_participantes;
CREATE POLICY "Gestor escreve escala_distribuicao_sabado_participantes"
  ON public.escala_distribuicao_sabado_participantes
  FOR ALL
  TO authenticated
  USING (public.get_my_role() = 'gestor')
  WITH CHECK (public.get_my_role() = 'gestor');

CREATE OR REPLACE FUNCTION public.distribuir_notas(p_sync_id UUID DEFAULT NULL)
RETURNS TABLE(nota_id UUID, administrador_id UUID, notas_abertas INTEGER)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nota                         RECORD;
  v_admin                        RECORD;
  v_especialidade                TEXT;
  v_pula_cockpit                 BOOLEAN;
  v_now_manaus                   TIMESTAMP WITHOUT TIME ZONE := timezone('America/Manaus', now());
  v_data_manaus                  DATE := timezone('America/Manaus', now())::DATE;
  v_hora_manaus                  TIME := timezone('America/Manaus', now())::TIME;
  v_escala_sabado_ativa          BOOLEAN := false;
  v_escala_sabado_participantes  UUID[] := ARRAY[]::UUID[];
BEGIN
  IF EXTRACT(DOW FROM v_now_manaus) = 6 THEN
    SELECT ARRAY_AGG(p.administrador_id ORDER BY p.administrador_id)
      INTO v_escala_sabado_participantes
    FROM public.escala_distribuicao_sabado e
    JOIN public.escala_distribuicao_sabado_participantes p
      ON p.escala_id = e.id
    WHERE e.data_escala = v_data_manaus
      AND v_hora_manaus <= e.hora_fim;

    v_escala_sabado_ativa := COALESCE(array_length(v_escala_sabado_participantes, 1), 0) > 0;
  END IF;

  FOR v_nota IN
    SELECT n.id, n.descricao, n.centro, n.data_criacao_sap, n.created_at
    FROM public.notas_manutencao n
    WHERE n.status = 'nova'
      AND n.administrador_id IS NULL
      AND (n.ordem_sap IS NULL OR TRIM(n.ordem_sap) IN ('', '0', '00000000'))
      AND NOT EXISTS (
        SELECT 1
        FROM public.ordens_notas_acompanhamento o
        WHERE o.nota_id = n.id
           OR (
             o.nota_id IS NULL
             AND COALESCE(NULLIF(BTRIM(o.numero_nota), ''), '') <> ''
             AND COALESCE(NULLIF(LTRIM(BTRIM(o.numero_nota), '0'), ''), '0')
                 = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
           )
      )
    ORDER BY n.data_criacao_sap ASC NULLS LAST, n.created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT r.especialidade, r.pula_cockpit
      INTO v_especialidade, v_pula_cockpit
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    ORDER BY LENGTH(r.palavra_chave) DESC NULLS LAST
    LIMIT 1;

    v_especialidade := COALESCE(v_especialidade, 'geral');
    v_pula_cockpit  := COALESCE(v_pula_cockpit, false);

    IF v_especialidade = 'cd_direto' THEN
      IF UPPER(COALESCE(v_nota.centro, '')) LIKE '%MANAUS%' THEN
        v_especialidade := 'cd_manaus';
      ELSIF UPPER(COALESCE(v_nota.centro, '')) LIKE '%TARUMA%'
         OR UPPER(COALESCE(v_nota.centro, '')) LIKE '%TURISMO%' THEN
        v_especialidade := 'cd_taruma';
      ELSE
        v_especialidade := 'geral';
      END IF;
    END IF;

    IF v_especialidade = 'geral' AND NOT v_pula_cockpit THEN
      IF UPPER(COALESCE(v_nota.centro, '')) LIKE '%MANAUS%' THEN
        v_especialidade := 'cd_manaus';
      ELSIF UPPER(COALESCE(v_nota.centro, '')) LIKE '%TARUMA%'
         OR UPPER(COALESCE(v_nota.centro, '')) LIKE '%TURISMO%' THEN
        v_especialidade := 'cd_taruma';
      END IF;
    END IF;

    IF v_especialidade IN ('cd_manaus', 'cd_taruma') THEN
      WITH stats AS (
        SELECT
          a.id,
          a.nome,
          a.meta_semanal,
          (SELECT COUNT(*)::INTEGER
           FROM public.notas_manutencao n_ab
           WHERE n_ab.administrador_id = a.id
             AND n_ab.status IN ('nova','em_andamento','encaminhada_fornecedor')
          ) AS open_count,
          (SELECT COALESCE(MAX(n_ld.distribuida_em), NULL)
           FROM public.notas_manutencao n_ld
           WHERE n_ld.administrador_id = a.id
          ) AS ultima_distribuicao,
          (SELECT COUNT(*)
           FROM public.notas_manutencao n7
           WHERE n7.administrador_id = a.id
             AND n7.distribuida_em >= NOW() - INTERVAL '7 days'
          ) AS notas_7d,
          (SELECT COUNT(*)
           FROM public.ordens_notas_acompanhamento o7
           WHERE o7.administrador_id = a.id
             AND o7.ordem_detectada_em >= NOW() - INTERVAL '7 days'
          ) AS ordens_7d,
          (SELECT COUNT(*)
           FROM public.notas_manutencao n_oa
           JOIN public.ordens_notas_acompanhamento o_oa ON o_oa.nota_id = n_oa.id
           WHERE n_oa.administrador_id = a.id
             AND o_oa.status_ordem_raw IN ('ABERTO','EM_EXECUCAO','EQUIPAMENTO_EM_CONSERTO')
          ) AS ordens_ativas
        FROM public.administradores a
        WHERE a.role = 'admin'
          AND a.ativo = true
          AND a.em_ferias = false
          AND a.especialidade = v_especialidade
      )
      SELECT
        id,
        open_count,
        ultima_distribuicao,
        (
          meta_semanal
          - (notas_7d * 1.0 + ordens_7d * 0.5)
          - CASE
              WHEN open_count <= 10 THEN 0
              WHEN open_count <= 20 THEN 8
              WHEN open_count <= 30 THEN 20
              ELSE 40
            END
          - ordens_ativas * 0.5
        ) AS prioridade
      INTO v_admin
      FROM stats
      ORDER BY prioridade DESC, ultima_distribuicao ASC NULLS FIRST, nome ASC
      LIMIT 1;

      IF NOT FOUND THEN
        v_especialidade := 'geral';
      END IF;
    END IF;

    IF NOT FOUND OR v_especialidade NOT IN ('cd_manaus', 'cd_taruma') THEN
      WITH stats AS (
        SELECT
          a.id,
          a.nome,
          a.meta_semanal,
          (SELECT COUNT(*)::INTEGER
           FROM public.notas_manutencao n_ab
           WHERE n_ab.administrador_id = a.id
             AND n_ab.status IN ('nova','em_andamento','encaminhada_fornecedor')
             AND (n_ab.ordem_sap IS NULL OR TRIM(n_ab.ordem_sap) IN ('', '0', '00000000'))
          ) AS open_count,
          (SELECT COALESCE(MAX(n_ld.distribuida_em), NULL)
           FROM public.notas_manutencao n_ld
           WHERE n_ld.administrador_id = a.id
          ) AS ultima_distribuicao,
          (SELECT COUNT(*)
           FROM public.notas_manutencao n7
           WHERE n7.administrador_id = a.id
             AND n7.distribuida_em >= NOW() - INTERVAL '7 days'
          ) AS notas_7d,
          (SELECT COUNT(*)
           FROM public.notas_manutencao n_hj
           WHERE n_hj.administrador_id = a.id
             AND n_hj.distribuida_em >= CURRENT_DATE
          ) AS notas_hoje
        FROM public.administradores a
        WHERE a.role = 'admin'
          AND a.ativo = true
          AND a.recebe_distribuicao = true
          AND a.em_ferias = false
          AND a.especialidade = v_especialidade
          AND (
            v_especialidade <> 'geral'
            OR NOT v_escala_sabado_ativa
            OR a.id = ANY(v_escala_sabado_participantes)
          )
      ),
      mediana AS (
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY open_count) AS mediana_abertas
        FROM stats
      )
      SELECT
        s.id,
        s.open_count,
        s.ultima_distribuicao,
        (
          (s.meta_semanal - s.notas_7d)
          - s.notas_hoje * 8
          - GREATEST(0, s.open_count::numeric - m.mediana_abertas) * 3
        ) AS prioridade
      INTO v_admin
      FROM stats s, mediana m
      ORDER BY prioridade DESC, ultima_distribuicao ASC NULLS FIRST, nome ASC
      LIMIT 1;

      IF NOT FOUND AND v_especialidade != 'geral' THEN
        WITH stats AS (
          SELECT
            a.id,
            a.nome,
            a.meta_semanal,
            (SELECT COUNT(*)::INTEGER
             FROM public.notas_manutencao n_ab
             WHERE n_ab.administrador_id = a.id
               AND n_ab.status IN ('nova','em_andamento','encaminhada_fornecedor')
               AND (n_ab.ordem_sap IS NULL OR TRIM(n_ab.ordem_sap) IN ('', '0', '00000000'))
            ) AS open_count,
            (SELECT COALESCE(MAX(n_ld.distribuida_em), NULL)
             FROM public.notas_manutencao n_ld
             WHERE n_ld.administrador_id = a.id
            ) AS ultima_distribuicao,
            (SELECT COUNT(*)
             FROM public.notas_manutencao n7
             WHERE n7.administrador_id = a.id
               AND n7.distribuida_em >= NOW() - INTERVAL '7 days'
            ) AS notas_7d,
            (SELECT COUNT(*)
             FROM public.notas_manutencao n_hj
             WHERE n_hj.administrador_id = a.id
               AND n_hj.distribuida_em >= CURRENT_DATE
            ) AS notas_hoje
          FROM public.administradores a
          WHERE a.role = 'admin'
            AND a.ativo = true
            AND a.recebe_distribuicao = true
            AND a.em_ferias = false
            AND a.especialidade = 'geral'
            AND (
              NOT v_escala_sabado_ativa
              OR a.id = ANY(v_escala_sabado_participantes)
            )
        ),
        mediana AS (
          SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY open_count) AS mediana_abertas
          FROM stats
        )
        SELECT
          s.id,
          s.open_count,
          s.ultima_distribuicao,
          (
            (s.meta_semanal - s.notas_7d)
            - s.notas_hoje * 8
            - GREATEST(0, s.open_count::numeric - m.mediana_abertas) * 3
          ) AS prioridade
        INTO v_admin
        FROM stats s, mediana m
        ORDER BY prioridade DESC, ultima_distribuicao ASC NULLS FIRST, nome ASC
        LIMIT 1;
      END IF;
    END IF;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE public.notas_manutencao
    SET administrador_id = v_admin.id,
        distribuida_em   = now(),
        exclui_cockpit   = v_pula_cockpit,
        updated_at       = now()
    WHERE id = v_nota.id;

    INSERT INTO public.distribuicao_log(nota_id, administrador_id, notas_abertas_no_momento, sync_id)
    VALUES (v_nota.id, v_admin.id, v_admin.open_count, p_sync_id);

    INSERT INTO public.notas_historico(nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
    VALUES (
      v_nota.id,
      'administrador_id',
      NULL,
      v_admin.id::TEXT,
      'Distribuicao automatica (' || v_especialidade || CASE WHEN v_pula_cockpit THEN '/pula_cockpit' ELSE '' END || ') - sync_id: ' || COALESCE(p_sync_id::TEXT, 'manual')
    );

    nota_id          := v_nota.id;
    administrador_id := v_admin.id;
    notas_abertas    := v_admin.open_count;
    RETURN NEXT;
  END LOOP;
END;
$$;
