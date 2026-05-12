-- 00245_cd_manaus_split_brenda_predial_daniel_equipamentos.sql
--
-- Split de responsabilidade no CD 104 (Manaus):
--   - Brenda Fonseca (especialidade 'cd_manaus')      -> PREDIAL  (mantida)
--   - Daniel Duran   (especialidade 'cd_manaus_equip') -> EQUIPAMENTOS (novo)
--
-- Tambem:
--   - MONTA CARGA / PLATAFORMA / EMPILHADEIRA deixam de ir automaticamente
--     para Gustavo (especialidade 'elevadores') no roteamento de notas:
--     passam a cair no pool 'geral'. Em CD Manaus (104), o override abaixo
--     captura essas notas para Daniel. Em outros centros, vao para o pool
--     geral.
--   - A CLASSIFICACAO em regras_distribuicao continua intacta:
--     vw_equipamentos_criticos e o dashboard de criticos seguem mostrando
--     essas categorias normalmente.
--
-- Mecanica em distribuir_notas:
--   1. Match normal por palavra-chave em regras_distribuicao.
--   2. Downgrade 'elevadores' -> 'geral' para MONTA CARGA / PLATAFORMA /
--      EMPILHADEIRA (Gustavo nao recebe mais essas).
--   3. Roteamento por centro (Manaus -> cd_manaus, Taruma -> cd_taruma).
--   4. Override CD 104: se descricao casa is_cd_manaus_equipamento, vira
--      'cd_manaus_equip' (Daniel). Aplicado tanto a 'cd_manaus' (Brenda)
--      quanto a sobrevivente 'elevadores' (caso ELEVADOR/GERADOR no CD 104
--      NAO vira equipamento -- ELEVADOR continua com Gustavo se nao casar).
--   5. Bloco 1 (donos fixos) passa a aceitar 'cd_manaus_equip'.
--
-- Backfill:
--   - Notas abertas Brenda no CD 104 que casam equipamento -> Daniel
--   - Ordens abertas no CD 104 com Brenda ou Gustavo cuja nota casa
--     equipamento -> Daniel
--   - Ordens MONTA CARGA/PLATAFORMA fora do CD 104 com Gustavo NAO sao
--     redistribuidas (ficam ate conclusao; novas notas vao para pool geral).

-- ============================================================
-- 1. Cadastrar Daniel Duran
-- ============================================================
INSERT INTO public.administradores (
  nome,
  email,
  role,
  ativo,
  max_notas,
  meta_semanal,
  especialidade,
  recebe_distribuicao,
  em_ferias
)
VALUES (
  'Daniel Duran Jacqueminouth da Silva',
  'danielduran@bemol.com.br',
  'admin',
  true,
  50,
  50,
  'cd_manaus_equip',
  false,
  false
)
ON CONFLICT (email) DO UPDATE SET
  nome                = EXCLUDED.nome,
  role                = 'admin',
  ativo               = true,
  especialidade       = 'cd_manaus_equip',
  recebe_distribuicao = false,
  em_ferias           = false,
  updated_at          = now();

-- ============================================================
-- 2. Helper: classifica descricao como "equipamento do CD Manaus"
-- ============================================================
-- Regex case-insensitive (~*); cobre variantes com e sem acento.
-- Inclui MONTA CARGA / PLATAFORMA / EMPILHADEIRA (que sairam de Gustavo).
-- NAO inclui keywords de refrigeracao (Suelem segue cuidando de AR-COND).
CREATE OR REPLACE FUNCTION public.is_cd_manaus_equipamento(p_descricao TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT COALESCE(p_descricao, '') ~* $re$(MONTA[\s\-]*CARGA|PLATAFORMA|EMPILHADEIRA|PALETEIRA|ESTEIRA|FLOW\s*RACK|ARQUEADORA|ENVELOPADORA|P[OÓ]RTICO|ANTENA\s+ANTIFURTO|SCANTOP|CADEADO\s+ELETR|CONTADORA\s+DE\s+C[EÉ]DULA|GRAMPEADOR\s+ELETR|INTERCOMUNICADOR|PAINEL[\s/_-]*SENHA|PAINEL\s+DE\s+SENHA|PARED[AÃ]O\s+DE\s+TV|SPLITTER|CABO\s+HDMI|SISTEMA\s+DE\s+SOM|BEBEDOURO|PURIFICADOR|CAFETEIRA|G[AÁ]S\s+P20|CADEIRA|MARCENARIA|M[OÓ]VEIS|TAPE[CÇ]ARIA|ADESIVO|INSULFILM|VIDRA[CÇ]ARIA|M[AÁ]RMORE|GRANITO|CANCELA\s+DO\s+ESTACIONAMENTO|CONFEC[CÇ][AÃ]O\s+DE\s+PLACA|CHAVEIRO|CARIMBO|INSTALA[CÇ][AÃ]O\s+PISO\s+T[AÁ]TIL|TOTEM|LETREIRO|PICOL[EÉ]|METAL[UÚ]RGICA|//TAL[UÚ]RGICA|REPARO\s+DE\s+EQUIPAMENTOS|REVITALIZA[CÇ][AÃ]O|CORTINA\s+DE\s+AR|INSPE[CÇ][AÃ]O\s+TERMOGR[AÁ]FICA|EXTINTOR|MANGUEIRA|AQUISI[CÇ][AÃ]O\s+(PE[CÇ]AS|COMPRESSOR|AMORTECEDOR|RODA))$re$;
$$;

COMMENT ON FUNCTION public.is_cd_manaus_equipamento(TEXT) IS
  'Classifica descricao como "equipamento" para roteamento exclusivo do CD 104 (Brenda Predial / Daniel Equipamentos). Inclui MONTA CARGA / PLATAFORMA / EMPILHADEIRA (que sairam de Gustavo).';

-- ============================================================
-- 3. Atualizar distribuir_notas
--    - downgrade elevadores -> geral para MONTA CARGA/PLATAFORMA/EMPILHADEIRA
--    - override CD 104 -> cd_manaus_equip
--    - bloco 1 aceita cd_manaus_equip
-- ============================================================
CREATE OR REPLACE FUNCTION public.distribuir_notas(p_sync_id UUID DEFAULT NULL)
RETURNS TABLE(nota_id UUID, administrador_id UUID, notas_abertas INTEGER)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nota          RECORD;
  v_admin         RECORD;
  v_especialidade TEXT;
  v_pula_cockpit  BOOLEAN;
  v_is_cd_manaus  BOOLEAN;
BEGIN
  FOR v_nota IN
    SELECT n.id, n.numero_nota, n.descricao, n.centro, n.data_criacao_sap, n.created_at
    FROM public.notas_manutencao n
    WHERE n.status = 'nova'
      AND n.administrador_id IS NULL
      AND COALESCE(n.exclui_cockpit, false) = false
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.notas_status_sap_aux aux
        WHERE aux.numero_nota_norm
          = COALESCE(NULLIF(LTRIM(BTRIM(n.numero_nota), '0'), ''), '0')
          AND aux.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
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

    IF v_especialidade = 'excluir' THEN
      UPDATE public.notas_manutencao
      SET exclui_cockpit = true,
          updated_at = now()
      WHERE id = v_nota.id;

      CONTINUE;
    END IF;

    -- ---------------------------------------------------------------
    -- DOWNGRADE elevadores -> geral para MONTA CARGA / PLATAFORMA / EMPILHADEIRA
    -- Gustavo nao distribui mais essas categorias. Classificacao em
    -- regras_distribuicao continua para o dashboard de Equipamentos Criticos.
    -- ---------------------------------------------------------------
    IF v_especialidade = 'elevadores'
       AND COALESCE(v_nota.descricao, '') ~* '(MONTA[\s\-]*CARGA|PLATAFORMA|EMPILHADEIRA)' THEN
      v_especialidade := 'geral';
    END IF;

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

    -- ---------------------------------------------------------------
    -- OVERRIDE CD MANAUS (centro 104):
    -- Se a nota e do CD Manaus E a descricao classifica como equipamento,
    -- redireciona para Daniel Duran (cd_manaus_equip).
    -- Aplicado a 'cd_manaus' (Brenda). Refrigeracao nao e tocada (Suelem
    -- segue cuidando de AR-COND globalmente).
    -- ---------------------------------------------------------------
    v_is_cd_manaus := UPPER(COALESCE(v_nota.centro, '')) LIKE '%MANAUS%';
    IF v_is_cd_manaus
       AND v_especialidade = 'cd_manaus'
       AND public.is_cd_manaus_equipamento(v_nota.descricao) THEN
      v_especialidade := 'cd_manaus_equip';
    END IF;

    -- Bloco 1: donos fixos (cd_manaus / cd_taruma / criticos / cd_manaus_equip)
    IF v_especialidade IN ('cd_manaus', 'cd_taruma', 'criticos', 'cd_manaus_equip') THEN
      WITH stats AS (
        SELECT
          a.id,
          a.nome,
          a.meta_semanal,
          (SELECT COUNT(*)::INTEGER
           FROM public.vw_notas_sem_ordem v
           WHERE v.administrador_id = a.id
          ) AS open_count,
          (SELECT COALESCE(MAX(n_ld.distribuida_em), NULL)
           FROM public.notas_manutencao n_ld
           WHERE n_ld.administrador_id = a.id
             AND COALESCE(n_ld.exclui_cockpit, false) = false
             AND NOT EXISTS (
               SELECT 1
               FROM public.notas_status_sap_aux aux_ld
               WHERE aux_ld.numero_nota_norm
                 = COALESCE(NULLIF(LTRIM(BTRIM(n_ld.numero_nota), '0'), ''), '0')
                 AND aux_ld.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
             )
          ) AS ultima_distribuicao,
          (SELECT COUNT(*)
           FROM public.notas_manutencao n7
           WHERE n7.administrador_id = a.id
             AND n7.distribuida_em >= NOW() - INTERVAL '7 days'
             AND COALESCE(n7.exclui_cockpit, false) = false
             AND NOT EXISTS (
               SELECT 1
               FROM public.notas_status_sap_aux aux7
               WHERE aux7.numero_nota_norm
                 = COALESCE(NULLIF(LTRIM(BTRIM(n7.numero_nota), '0'), ''), '0')
                 AND aux7.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
             )
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

    IF NOT FOUND OR v_especialidade NOT IN ('cd_manaus', 'cd_taruma', 'criticos', 'cd_manaus_equip') THEN
      WITH stats AS (
        SELECT
          a.id,
          a.nome,
          a.meta_semanal,
          (SELECT COUNT(*)::INTEGER
           FROM public.vw_notas_sem_ordem v
           WHERE v.administrador_id = a.id
          ) AS open_count,
          (SELECT COALESCE(MAX(n_ld.distribuida_em), NULL)
           FROM public.notas_manutencao n_ld
           WHERE n_ld.administrador_id = a.id
             AND COALESCE(n_ld.exclui_cockpit, false) = false
             AND NOT EXISTS (
               SELECT 1
               FROM public.notas_status_sap_aux aux_ld
               WHERE aux_ld.numero_nota_norm
                 = COALESCE(NULLIF(LTRIM(BTRIM(n_ld.numero_nota), '0'), ''), '0')
                 AND aux_ld.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
             )
          ) AS ultima_distribuicao,
          (SELECT COUNT(*)
           FROM public.notas_manutencao n7
           WHERE n7.administrador_id = a.id
             AND n7.distribuida_em >= NOW() - INTERVAL '7 days'
             AND COALESCE(n7.exclui_cockpit, false) = false
             AND NOT EXISTS (
               SELECT 1
               FROM public.notas_status_sap_aux aux7
               WHERE aux7.numero_nota_norm
                 = COALESCE(NULLIF(LTRIM(BTRIM(n7.numero_nota), '0'), ''), '0')
                 AND aux7.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
             )
          ) AS notas_7d,
          (SELECT COUNT(*)
           FROM public.notas_manutencao n_hj
           WHERE n_hj.administrador_id = a.id
             AND n_hj.distribuida_em >= CURRENT_DATE
             AND COALESCE(n_hj.exclui_cockpit, false) = false
             AND NOT EXISTS (
               SELECT 1
               FROM public.notas_status_sap_aux aux_hj
               WHERE aux_hj.numero_nota_norm
                 = COALESCE(NULLIF(LTRIM(BTRIM(n_hj.numero_nota), '0'), ''), '0')
                 AND aux_hj.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
             )
          ) AS notas_hoje
        FROM public.administradores a
        WHERE a.role = 'admin'
          AND a.ativo = true
          AND a.recebe_distribuicao = true
          AND a.em_ferias = false
          AND a.especialidade = v_especialidade
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
             FROM public.vw_notas_sem_ordem v
             WHERE v.administrador_id = a.id
            ) AS open_count,
            (SELECT COALESCE(MAX(n_ld.distribuida_em), NULL)
             FROM public.notas_manutencao n_ld
             WHERE n_ld.administrador_id = a.id
               AND COALESCE(n_ld.exclui_cockpit, false) = false
               AND NOT EXISTS (
                 SELECT 1
                 FROM public.notas_status_sap_aux aux_ld
                 WHERE aux_ld.numero_nota_norm
                   = COALESCE(NULLIF(LTRIM(BTRIM(n_ld.numero_nota), '0'), ''), '0')
                   AND aux_ld.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
               )
            ) AS ultima_distribuicao,
            (SELECT COUNT(*)
             FROM public.notas_manutencao n7
             WHERE n7.administrador_id = a.id
               AND n7.distribuida_em >= NOW() - INTERVAL '7 days'
               AND COALESCE(n7.exclui_cockpit, false) = false
               AND NOT EXISTS (
                 SELECT 1
                 FROM public.notas_status_sap_aux aux7
                 WHERE aux7.numero_nota_norm
                   = COALESCE(NULLIF(LTRIM(BTRIM(n7.numero_nota), '0'), ''), '0')
                   AND aux7.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
               )
            ) AS notas_7d,
            (SELECT COUNT(*)
             FROM public.notas_manutencao n_hj
             WHERE n_hj.administrador_id = a.id
               AND n_hj.distribuida_em >= CURRENT_DATE
               AND COALESCE(n_hj.exclui_cockpit, false) = false
               AND NOT EXISTS (
                 SELECT 1
                 FROM public.notas_status_sap_aux aux_hj
                 WHERE aux_hj.numero_nota_norm
                   = COALESCE(NULLIF(LTRIM(BTRIM(n_hj.numero_nota), '0'), ''), '0')
                   AND aux_hj.status_canonico IN ('CANCELADA', 'VIROU_ORDEM')
               )
            ) AS notas_hoje
          FROM public.administradores a
          WHERE a.role = 'admin'
            AND a.ativo = true
            AND a.recebe_distribuicao = true
            AND a.em_ferias = false
            AND a.especialidade = 'geral'
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
    SET administrador_id    = v_admin.id,
        distribuida_em      = now(),
        exclui_cockpit      = v_pula_cockpit,
        equipamento_critico = CASE
            WHEN public.classificar_equipamento_critico(v_nota.descricao) = ANY(
              ARRAY['ELEVADOR','GERADOR','MONTA CARGA','SUBESTACAO','PLATAFORMA']
            ) THEN public.classificar_equipamento_critico(v_nota.descricao)
            ELSE NULL
          END,
        updated_at          = now()
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

-- ============================================================
-- 4. Backfill: redistribuir notas/ordens abertas no CD 104
--    de Brenda/Gustavo -> Daniel quando casa is_cd_manaus_equipamento.
-- ============================================================
DO $$
DECLARE
  v_brenda  UUID;
  v_gustavo UUID;
  v_daniel  UUID;
  v_notas_movidas  INTEGER := 0;
  v_ordens_movidas INTEGER := 0;
BEGIN
  SELECT id INTO v_brenda  FROM public.administradores WHERE LOWER(email) = 'brendafonseca@bemol.com.br' LIMIT 1;
  SELECT id INTO v_gustavo FROM public.administradores WHERE LOWER(email) = 'gustavoandrade@bemol.com.br' LIMIT 1;
  SELECT id INTO v_daniel  FROM public.administradores WHERE LOWER(email) = 'danielduran@bemol.com.br'    LIMIT 1;

  IF v_daniel IS NULL THEN
    RAISE EXCEPTION 'Daniel Duran nao encontrado apos cadastro';
  END IF;

  -- 4.1 Notas abertas atribuidas a Brenda no CD 104
  --     que casam keyword equipamento -> Daniel
  IF v_brenda IS NOT NULL THEN
    WITH notas_alvo AS (
      SELECT n.id
      FROM public.notas_manutencao n
      WHERE n.administrador_id = v_brenda
        AND COALESCE(n.exclui_cockpit, false) = false
        AND UPPER(COALESCE(n.centro, '')) LIKE '%MANAUS%'
        AND public.is_cd_manaus_equipamento(n.descricao)
        AND n.status IN ('nova','em_andamento','encaminhada_fornecedor')
    ),
    upd AS (
      UPDATE public.notas_manutencao n
      SET administrador_id = v_daniel,
          updated_at       = now()
      FROM notas_alvo
      WHERE n.id = notas_alvo.id
      RETURNING n.id
    ),
    hist AS (
      INSERT INTO public.notas_historico(nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
      SELECT u.id, 'administrador_id', v_brenda::TEXT, v_daniel::TEXT,
             'Backfill 00245: split CD 104 (Brenda Predial / Daniel Equipamentos)'
      FROM upd u
      RETURNING nota_id
    )
    SELECT COUNT(*) INTO v_notas_movidas FROM hist;
  END IF;

  -- 4.2 Ordens abertas no CD 104 com Brenda OU Gustavo cuja descricao
  --     da nota associada casa keyword equipamento -> Daniel
  --     (status_ordem foi dropado na 00168 -- usa status_ordem_raw)
  WITH ordens_alvo AS (
    SELECT o.id
    FROM public.ordens_notas_acompanhamento o
    LEFT JOIN public.notas_manutencao n ON n.id = o.nota_id
    WHERE o.centro = '104'
      AND COALESCE(o.status_ordem_raw,'') NOT IN (
        'CONCLUIDO','CANCELADO',
        'AGUARDANDO_FATURAMENTO_NF',
        'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
        'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
      )
      AND o.administrador_id IN (
        SELECT x FROM unnest(ARRAY[v_brenda, v_gustavo]) x WHERE x IS NOT NULL
      )
      AND public.is_cd_manaus_equipamento(COALESCE(n.descricao, ''))
  ),
  upd AS (
    UPDATE public.ordens_notas_acompanhamento o
    SET administrador_id = v_daniel,
        updated_at       = now()
    FROM ordens_alvo
    WHERE o.id = ordens_alvo.id
    RETURNING o.id
  )
  SELECT COUNT(*) INTO v_ordens_movidas FROM upd;

  RAISE NOTICE 'Backfill CD 104 split: % notas e % ordens migradas para Daniel Duran',
    v_notas_movidas, v_ordens_movidas;
END $$;
