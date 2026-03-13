/**
 * SLA thresholds (calendar days, same logic as getAgingDays).
 * Must stay in sync with the SQL is_critico expression in vw_iso_por_admin.
 * Current SQL migration: 00160_align_iso_critico_5d.sql
 */
export const SLA_DENTRO_PRAZO_MAX_DAYS = 1  // 0-1 d → verde
export const SLA_ESTOURADO_MIN_DAYS    = 3  // 3-4 d → laranja
export const SLA_CRITICO_MIN_DAYS      = 5  // 5+  d → vermelho pulsante
