truncate passageiro_voo, sessao, passageiro, funcionario, parecer, atraso, voo, aeronave, motivo restart identity cascade;

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

('AD4100', 'PR-ADA', 'GRU', 'SDU', '2026-10-05 07:00', '2026-10-05 08:00'),
('AD4101', 'PR-ADA', 'SDU', 'CNF', '2026-10-05 08:40', '2026-10-05 09:40'),
('AD4102', 'PR-ADA', 'CNF', 'GRU', '2026-10-05 10:20', '2026-10-05 11:30'),
('AD4103', 'PR-ADA', 'GRU', 'POA', '2026-10-05 12:10', '2026-10-05 13:50'),

('AD2200', 'PR-BEL', 'CGH', 'CWB', '2026-10-05 06:30', '2026-10-05 07:40'),
('AD2201', 'PR-BEL', 'CWB', 'FLN', '2026-10-05 08:20', '2026-10-05 09:10'),
('AD2202', 'PR-BEL', 'FLN', 'CGH', '2026-10-05 09:50', '2026-10-05 11:00'),
('AD2203', 'PR-BEL', 'CGH', 'VIX', '2026-10-05 11:40', '2026-10-05 13:10'),

('AD3300', 'PR-COR', 'VCP', 'RAO', '2026-10-05 07:15', '2026-10-05 08:15'),
('AD3301', 'PR-COR', 'RAO', 'VCP', '2026-10-05 08:55', '2026-10-05 09:55'),
('AD3302', 'PR-COR', 'VCP', 'UDI', '2026-10-05 10:35', '2026-10-05 11:45'),
('AD3303', 'PR-COR', 'UDI', 'VCP', '2026-10-05 12:25', '2026-10-05 13:35');

truncate evento_simulado restart identity;
update relogio set agora = '2026-10-05 06:00' where id = 1;

insert into evento_simulado (acontece_em, tipo, voo_numero, motivo, minutos, area, texto, autor) values
('2026-10-05 06:15', 'ATRASO',    'AD2200', '71', 30, null,         'Nevoeiro em CGH, pista fechada',                 'Aeroporto CGH (registro rápido)'),
('2026-10-05 06:40', 'ATRASO',    'AD4100', '41', 55, null,         'Pane no sistema de freios detectada no pré-voo', 'Aeroporto GRU (registro rápido)'),
('2026-10-05 07:30', 'PARECER',   'AD4100', '93', null, 'CCO',        'Aeronave chegou tarde da pernoite',            'Marina Costa'),
('2026-10-05 08:00', 'PARECER',   'AD4100', '41', null, 'Piloto',     'Alerta de freio no painel durante o check',    'Cmte. Rafael Lima'),
('2026-10-05 08:30', 'PARECER',   'AD4100', '41', null, 'Manutenção', 'Troca de sensor do freio número 2',            'Paula Mendes'),
('2026-10-05 08:45', 'ATRASO',    'AD3301', '63', 25, null,         'Comandante chegou atrasado ao aeroporto',        'Aeroporto RAO (registro rápido)'),
('2026-10-05 09:00', 'VALIDACAO', 'AD4100', '41', null, null,         null,                                           'Marina Costa'),
('2026-10-05 10:10', 'ATRASO',    'AD3302', '81', 15, null,         'Fluxo restrito pelo controle de tráfego',        'Aeroporto VCP (registro rápido)'),
('2026-10-05 10:45', 'ATRASO',    'AD4102', '18', 10, null,         'Esteira de bagagem parada em CNF',               'Aeroporto CNF (registro rápido)');

insert into funcionario (codigo, nome, area, senha_hash) values
('AL-1001', 'Marina Costa',   'CCO',        extensions.crypt('alcar2026', extensions.gen_salt('bf'))),
('AL-2002', 'Ricardo Nunes',  'Aeroporto',  extensions.crypt('alcar2026', extensions.gen_salt('bf'))),
('AL-3003', 'Paula Mendes',   'Manutenção', extensions.crypt('alcar2026', extensions.gen_salt('bf')));

insert into passageiro (nome, email, senha_hash) values
('Ana Ribeiro', 'ana@exemplo.com', extensions.crypt('senha123', extensions.gen_salt('bf')));

insert into passageiro_voo (passageiro_id, voo_id)
select 1, id from voo where numero in ('AD4102', 'AD2203');
