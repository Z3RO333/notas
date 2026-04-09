-- Check if notas_convergencia_cockpit has sync_id column
SELECT column_name FROM information_schema.columns
WHERE table_name = 'notas_convergencia_cockpit' AND table_schema = 'public'
ORDER BY ordinal_position;
