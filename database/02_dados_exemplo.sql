-- =====================================================================
--  Dados de exemplo: um dia de operação (05/10/2026) com 3 aeronaves
--  Rode DEPOIS do 01_schema.sql
-- =====================================================================

-- Limpa os dados anteriores (permite rodar este script mais de uma vez)
truncate parecer, atraso, voo, aeronave, motivo restart identity cascade;

-- Motivos (códigos inspirados na tabela padrão de atrasos da IATA)
insert into motivo (codigo, descricao, categoria, area_responsavel, reativo) values
('11', 'Aceitação tardia de passageiros (check-in)',    'Passageiros e bagagem', 'Aeroporto',           false),
('18', 'Processamento de bagagem',                      'Passageiros e bagagem', 'Aeroporto',           false),
('33', 'Equipamento de carregamento indisponível',      'Solo',                  'Aeroporto',           false),
('36', 'Abastecimento de combustível',                  'Solo',                  'Aeroporto',           false),
('41', 'Defeito técnico na aeronave',                   'Técnico',               'Manutenção',          false),
('63', 'Apresentação tardia da tripulação técnica',     'Tripulação',            'Escala de tripulação', false),
('71', 'Condições meteorológicas no aeroporto',         'Meteorologia',          'Externo',             false),
('81', 'Restrição do controle de tráfego aéreo',        'Tráfego aéreo',         'Externo',             false),
('87', 'Infraestrutura aeroportuária',                  'Aeroporto',             'Aeroporto',           false),
('93', 'Chegada tardia da aeronave (atraso herdado)',   'Reativo',               'Gerado pelo sistema', true);

insert into aeronave (matricula, modelo) values
('PR-ADA', 'Airbus A320'),
('PR-BEL', 'Embraer E195'),
('PR-COR', 'ATR 72-600');

insert into voo (numero, matricula, origem, destino, partida_prevista, chegada_prevista) values
-- PR-ADA: turnos apertados (40 min de solo -> só 10 min de folga)
('AD4100', 'PR-ADA', 'GRU', 'SDU', '2026-10-05 07:00', '2026-10-05 08:00'),
('AD4101', 'PR-ADA', 'SDU', 'CNF', '2026-10-05 08:40', '2026-10-05 09:40'),
('AD4102', 'PR-ADA', 'CNF', 'GRU', '2026-10-05 10:20', '2026-10-05 11:30'),
('AD4103', 'PR-ADA', 'GRU', 'POA', '2026-10-05 12:10', '2026-10-05 13:50'),
-- PR-BEL
('AD2200', 'PR-BEL', 'CGH', 'CWB', '2026-10-05 06:30', '2026-10-05 07:40'),
('AD2201', 'PR-BEL', 'CWB', 'FLN', '2026-10-05 08:20', '2026-10-05 09:10'),
('AD2202', 'PR-BEL', 'FLN', 'CGH', '2026-10-05 09:50', '2026-10-05 11:00'),
('AD2203', 'PR-BEL', 'CGH', 'VIX', '2026-10-05 11:40', '2026-10-05 13:10'),
-- PR-COR
('AD3300', 'PR-COR', 'VCP', 'RAO', '2026-10-05 07:15', '2026-10-05 08:15'),
('AD3301', 'PR-COR', 'RAO', 'VCP', '2026-10-05 08:55', '2026-10-05 09:55'),
('AD3302', 'PR-COR', 'VCP', 'UDI', '2026-10-05 10:35', '2026-10-05 11:45'),
('AD3303', 'PR-COR', 'UDI', 'VCP', '2026-10-05 12:25', '2026-10-05 13:35');

-- Registros feitos "no calor da crise" (a propagação acontece sozinha)
select registrar_atraso((select id from voo where numero = 'AD4100'), '41', 55, 'Pane no sistema de freios detectada no pré-voo');
select registrar_atraso((select id from voo where numero = 'AD4102'), '18', 10, 'Esteira de bagagem parada em CNF');
select registrar_atraso((select id from voo where numero = 'AD2200'), '71', 30, 'Nevoeiro em CGH, pista fechada');
select registrar_atraso((select id from voo where numero = 'AD3301'), '63', 25, 'Comandante chegou atrasado ao aeroporto');
select registrar_atraso((select id from voo where numero = 'AD3302'), '81', 15, 'Fluxo restrito pelo controle de tráfego');

-- Visões diferentes de cada área sobre a pane do AD4100
select registrar_parecer(a.id, 'CCO',        '93', 'Aeronave chegou tarde da pernoite')         from atraso a join voo v on v.id = a.voo_id where v.numero = 'AD4100' and a.tipo = 'ORIGINADOR';
select registrar_parecer(a.id, 'Piloto',     '41', 'Alerta de freio no painel durante o check')  from atraso a join voo v on v.id = a.voo_id where v.numero = 'AD4100' and a.tipo = 'ORIGINADOR';
select registrar_parecer(a.id, 'Manutenção', '41', 'Troca de sensor do freio número 2')          from atraso a join voo v on v.id = a.voo_id where v.numero = 'AD4100' and a.tipo = 'ORIGINADOR';

-- Causa oficial definida após a análise
select validar_atraso(a.id, '41') from atraso a join voo v on v.id = a.voo_id where v.numero = 'AD4100' and a.tipo = 'ORIGINADOR';
