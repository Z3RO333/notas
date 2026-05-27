-- 00258_remove_david_bezerra_cd_equip.sql
--
-- David Bezerra Viana (19233) cuida de bebedouro/arqueadora/esteira — tudo CD.
-- Ordens roteadas via is_cd_manaus_equipamento → Duran. Não pertence à carteira PMPL.
DELETE FROM public.pmpl_carteira_fornecedor WHERE fornecedor_codigo = '19233';
