-- 00003_create_indexes.sql
-- Indexes para performance do cockpit

-- Fila do admin: buscar notas por admin + status
CREATE INDEX idx_notas_admin_status ON public.notas_manutencao(administrador_id, status);

-- Distribuicao: encontrar notas nao atribuidas rapidamente
CREATE INDEX idx_notas_nova_unassigned
  ON public.notas_manutencao(created_at ASC)
  WHERE status = 'nova' AND administrador_id IS NULL;

-- Idempotencia no upsert
CREATE INDEX idx_notas_numero ON public.notas_manutencao(numero_nota);

-- Watermark do sync
CREATE INDEX idx_notas_streaming_ts ON public.notas_manutencao(streaming_timestamp DESC);

-- Filtros comuns
CREATE INDEX idx_notas_status ON public.notas_manutencao(status);
CREATE INDEX idx_notas_created ON public.notas_manutencao(created_at DESC);
CREATE INDEX idx_notas_centro ON public.notas_manutencao(centro);
CREATE INDEX idx_notas_prioridade ON public.notas_manutencao(prioridade);

-- Auditoria
CREATE INDEX idx_historico_nota ON public.notas_historico(nota_id);
CREATE INDEX idx_historico_created ON public.notas_historico(created_at DESC);

-- Sync logs
CREATE INDEX idx_sync_log_started ON public.sync_log(started_at DESC);

-- Distribuicao log
CREATE INDEX idx_distribuicao_admin ON public.distribuicao_log(administrador_id);

-- Auth lookup
CREATE INDEX idx_admin_auth_user ON public.administradores(auth_user_id);
