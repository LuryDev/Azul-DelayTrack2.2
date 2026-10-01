-- =====================================================================
--  Sistema de Definição de Motivos de Atrasos
--  Banco de dados (PostgreSQL / Supabase)
--
--  Ideia central:
--    * ORIGINADOR  -> o evento que começou o problema (pane, clima...)
--    * CONSEQUENTE -> atraso herdado do voo anterior da mesma aeronave
--  Cada consequente aponta para o seu "atraso pai". Seguindo essa
--  cadeia até o topo encontramos a CAUSA RAIZ, sem reclassificação
--  manual.
-- =====================================================================

-- Limpa tudo (permite rodar o script de novo sem erro)
drop function if exists cadastrar_passageiro, entrar_passageiro, entrar_funcionario, sessao_atual,
                        sair, meus_voos, acompanhar_voo, deixar_de_acompanhar, funcionario_da_sessao,
                        passageiro_da_sessao, motivo_para_cliente, op_registrar_atraso, op_remover_atraso,
                        op_registrar_parecer, op_validar_atraso cascade;
drop function if exists agora, aplicar_eventos, avancar_relogio, reiniciar_simulacao, fase_do_voo cascade;
drop table    if exists passageiro_voo, sessao, passageiro, funcionario, evento_simulado, relogio cascade;
drop view     if exists vw_minutos_por_causa_raiz cascade;
drop view     if exists vw_minutos_por_sintoma    cascade;
drop view     if exists vw_atraso_detalhado       cascade;
drop view     if exists vw_voo_resumo             cascade;
drop function if exists propagar_atrasos(text, date)            cascade;
drop function if exists registrar_atraso(int, text, int, text)  cascade;
drop function if exists remover_atraso(int)                     cascade;
drop function if exists registrar_parecer(int, text, text, text) cascade;
drop function if exists validar_atraso(int, text)               cascade;
drop function if exists cadeia_atraso(int)                      cascade;
drop table    if exists parecer  cascade;
drop table    if exists atraso   cascade;
drop table    if exists voo      cascade;
drop table    if exists motivo   cascade;
drop table    if exists aeronave cascade;
drop table    if exists configuracao cascade;

-- ---------------------------------------------------------------------
-- TABELAS
-- ---------------------------------------------------------------------

-- Relógio da simulação: o "agora" do sistema. Na demonstração ele é
-- avançado pela tela da operação; em produção seria simplesmente now().
create table relogio (
    id    int primary key default 1 check (id = 1),
    agora timestamp not null
);
insert into relogio values (1, '2026-10-05 06:00');

create function agora() returns timestamp
language sql stable
set search_path = public
as $$ select agora from relogio where id = 1 $$;

create table configuracao (
    chave text primary key,
    valor int  not null
);
-- Tempo mínimo de solo entre um pouso e a próxima decolagem (minutos).
-- Tudo que sobrar além disso é "folga" e absorve parte do atraso.
insert into configuracao values ('tempo_minimo_solo', 30);

create table aeronave (
    matricula text primary key,          -- ex.: PR-ABC
    modelo    text not null
);

create table motivo (
    codigo           text primary key,   -- inspirado nos códigos IATA
    descricao        text not null,
    categoria        text not null,      -- Técnico, Meteorologia, Solo...
    area_responsavel text not null,      -- área dona do problema
    reativo          boolean not null default false  -- true = motivo de atraso herdado
);

create table voo (
    id               serial primary key,
    numero           text not null,      -- ex.: AD4102
    matricula        text not null references aeronave(matricula),
    origem           char(3) not null,
    destino          char(3) not null,
    partida_prevista timestamp not null,
    chegada_prevista timestamp not null,
    check (chegada_prevista > partida_prevista)
);
create index ix_voo_aeronave_data on voo (matricula, partida_prevista);

create table atraso (
    id            serial primary key,
    voo_id        int  not null references voo(id) on delete cascade,
    motivo_codigo text not null references motivo(codigo),
    minutos       int  not null check (minutos > 0),
    tipo          text not null check (tipo in ('ORIGINADOR', 'CONSEQUENTE')),
    atraso_pai_id int  references atraso(id) on delete cascade,
    status        text not null default 'PROVISORIO'
                  check (status in ('PROVISORIO', 'VALIDADO')),
    observacao    text,
    registrado_por text,                 -- funcionário que registrou
    registrado_em timestamp not null default now(),
    -- regra de integridade: originador não tem pai, consequente sempre tem
    check ((tipo = 'ORIGINADOR'  and atraso_pai_id is null) or
           (tipo = 'CONSEQUENTE' and atraso_pai_id is not null))
);
create index ix_atraso_voo on atraso (voo_id);
create index ix_atraso_pai on atraso (atraso_pai_id);

-- Visão de cada área (CCO, piloto, manutenção...) sobre um atraso
create table parecer (
    id            serial primary key,
    atraso_id     int  not null references atraso(id) on delete cascade,
    area          text not null,
    motivo_codigo text not null references motivo(codigo),
    justificativa text,
    funcionario   text,                  -- quem registrou o parecer
    criado_em     timestamp not null default now()
);

-- ---------------------------------------------------------------------
-- PROPAGAÇÃO AUTOMÁTICA
-- Percorre os voos da aeronave no dia, em ordem, e recria os atrasos
-- consequentes. Exemplo:
--   voo anterior chegou 40 min atrasado, folga no solo = 10 min
--   -> próximo voo herda 30 min, ligados ao atraso do voo anterior.
-- ---------------------------------------------------------------------
create function propagar_atrasos(p_matricula text, p_data date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_solo      int;
    v_voo       record;
    v_ant_id      int;           -- voo anterior da mesma aeronave
    v_ant_chegada timestamp;
    v_atraso_ant  int := 0;      -- atraso de chegada do voo anterior
    v_folga     int;
    v_herdado   int;
    v_restante  int;
    v_pai       record;
    v_parte     int;
    v_orig      int;
begin
    select valor into v_solo from configuracao where chave = 'tempo_minimo_solo';

    for v_voo in
        select * from voo
         where matricula = p_matricula
           and partida_prevista::date = p_data
         order by partida_prevista
    loop
        -- apaga os consequentes antigos deste voo (serão recalculados)
        delete from atraso where voo_id = v_voo.id and tipo = 'CONSEQUENTE';

        v_herdado := 0;
        if v_ant_id is not null and v_atraso_ant > 0 then
            v_folga := greatest(0,
                extract(epoch from (v_voo.partida_prevista - v_ant_chegada))::int / 60
                - v_solo);
            v_herdado := greatest(0, v_atraso_ant - v_folga);

            -- distribui os minutos herdados entre os atrasos do voo anterior
            v_restante := v_herdado;
            for v_pai in
                select id, minutos from atraso
                 where voo_id = v_ant_id
                 order by (tipo = 'ORIGINADOR') desc, id
            loop
                exit when v_restante <= 0;
                v_parte := least(v_restante, v_pai.minutos);
                insert into atraso (voo_id, motivo_codigo, minutos, tipo, atraso_pai_id, observacao)
                values (v_voo.id, '93', v_parte, 'CONSEQUENTE', v_pai.id,
                        'Gerado automaticamente: chegada tardia da aeronave');
                v_restante := v_restante - v_parte;
            end loop;
        end if;

        -- atrasos novos que nasceram neste voo
        select coalesce(sum(minutos), 0) into v_orig
          from atraso where voo_id = v_voo.id and tipo = 'ORIGINADOR';

        -- supõe tempo de voo mantido: atraso de chegada = atraso de partida
        v_atraso_ant := v_herdado + v_orig;
        v_ant_id      := v_voo.id;
        v_ant_chegada := v_voo.chegada_prevista;
    end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- FUNÇÕES CHAMADAS PELO SITE (supabase.rpc)
-- ---------------------------------------------------------------------

-- Registro rápido feito pelo aeroporto no momento da crise
create function registrar_atraso(p_voo_id int, p_motivo text, p_minutos int, p_observacao text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id  int;
    v_voo record;
begin
    select * into v_voo from voo where id = p_voo_id;
    if not found then
        raise exception 'Voo % não encontrado', p_voo_id;
    end if;
    if (select reativo from motivo where codigo = p_motivo) then
        raise exception 'O motivo % é gerado automaticamente pelo sistema', p_motivo;
    end if;

    insert into atraso (voo_id, motivo_codigo, minutos, tipo, observacao, registrado_em)
    values (p_voo_id, p_motivo, p_minutos, 'ORIGINADOR', p_observacao, agora())
    returning id into v_id;

    perform propagar_atrasos(v_voo.matricula, v_voo.partida_prevista::date);
    return v_id;
end;
$$;

-- Remove um atraso originador (ex.: registrado por engano) e recalcula
create function remover_atraso(p_atraso_id int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_voo record;
begin
    select v.* into v_voo
      from atraso a join voo v on v.id = a.voo_id
     where a.id = p_atraso_id and a.tipo = 'ORIGINADOR';
    if not found then
        raise exception 'Somente atrasos originadores podem ser removidos';
    end if;

    delete from atraso where id = p_atraso_id;
    perform propagar_atrasos(v_voo.matricula, v_voo.partida_prevista::date);
end;
$$;

-- Cada área registra sua visão sobre um atraso
create function registrar_parecer(p_atraso_id int, p_area text, p_motivo text, p_justificativa text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id int;
begin
    insert into parecer (atraso_id, area, motivo_codigo, justificativa)
    values (p_atraso_id, p_area, p_motivo, p_justificativa)
    returning id into v_id;
    return v_id;
end;
$$;

-- Define a causa oficial de um originador. Os consequentes da cadeia
-- passam a apontar para a causa correta automaticamente, pois herdam
-- a causa raiz pelo vínculo (não é preciso reclassificar nenhum deles).
create function validar_atraso(p_atraso_id int, p_motivo_final text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update atraso
       set motivo_codigo = p_motivo_final,
           status        = 'VALIDADO'
     where id = p_atraso_id and tipo = 'ORIGINADOR';
    if not found then
        raise exception 'Somente atrasos originadores são validados; os consequentes herdam a causa';
    end if;
end;
$$;

-- Árvore completa a partir de uma causa raiz (CTE recursiva)
create function cadeia_atraso(p_raiz_id int)
returns table (
    atraso_id int, atraso_pai_id int, nivel int, tipo text,
    motivo_codigo text, motivo_descricao text, minutos int,
    voo_id int, voo_numero text, origem char(3), destino char(3),
    partida_prevista timestamp
)
language sql
stable
as $$
    with recursive arvore as (
        select a.id, a.atraso_pai_id, 0 as nivel
          from atraso a where a.id = p_raiz_id
        union all
        select f.id, f.atraso_pai_id, arvore.nivel + 1
          from atraso f join arvore on f.atraso_pai_id = arvore.id
    )
    select a.id, a.atraso_pai_id, arvore.nivel, a.tipo,
           a.motivo_codigo, m.descricao, a.minutos,
           v.id, v.numero, v.origem, v.destino, v.partida_prevista
      from arvore
      join atraso a on a.id = arvore.id
      join motivo m on m.codigo = a.motivo_codigo
      join voo    v on v.id = a.voo_id
     order by arvore.nivel, v.partida_prevista, a.id;
$$;

-- ---------------------------------------------------------------------
-- VIEWS (consultadas pelo site)
-- ---------------------------------------------------------------------

-- Cada atraso com a sua causa raiz (CTE recursiva subindo a cadeia)
create view vw_atraso_detalhado as
with recursive subida as (
    select id as atraso_id, id as atual_id, atraso_pai_id, 0 as profundidade
      from atraso
    union all
    select s.atraso_id, a.id, a.atraso_pai_id, s.profundidade + 1
      from subida s join atraso a on a.id = s.atraso_pai_id
),
raiz as (
    select atraso_id, atual_id as raiz_id, profundidade
      from subida where atraso_pai_id is null
)
select a.id, a.voo_id, v.numero as voo_numero, v.matricula,
       v.origem, v.destino, v.partida_prevista,
       a.tipo, a.status, a.minutos, a.atraso_pai_id, a.observacao,
       a.motivo_codigo           as sintoma_codigo,
       ms.descricao              as sintoma_descricao,
       r.raiz_id,
       ar.motivo_codigo          as causa_raiz_codigo,
       mr.descricao              as causa_raiz_descricao,
       mr.categoria              as causa_raiz_categoria,
       mr.area_responsavel       as causa_raiz_area,
       ar.status                 as causa_raiz_status,
       r.profundidade
  from atraso a
  join voo    v  on v.id  = a.voo_id
  join motivo ms on ms.codigo = a.motivo_codigo
  join raiz   r  on r.atraso_id = a.id
  join atraso ar on ar.id = r.raiz_id
  join motivo mr on mr.codigo = ar.motivo_codigo;

-- Resumo de cada voo: atraso total, herdado e novo
create view vw_voo_resumo as
select r.*,
       -- fase do voo conforme o relógio da simulação
       case
         when agora() >= r.chegada_estimada then 'POUSOU'
         when agora() >= r.partida_estimada then 'EM_VOO'
         when agora() >= r.partida_estimada - interval '40 minutes' then 'EMBARQUE'
         else 'PROGRAMADO'
       end as fase
  from (
    select v.id, v.numero, v.matricula, v.origem, v.destino,
           v.partida_prevista, v.chegada_prevista,
           coalesce(sum(a.minutos), 0)::int as atraso_total,
           coalesce(sum(a.minutos) filter (where a.tipo = 'CONSEQUENTE'), 0)::int as atraso_herdado,
           coalesce(sum(a.minutos) filter (where a.tipo = 'ORIGINADOR'),  0)::int as atraso_novo,
           v.partida_prevista + make_interval(mins => coalesce(sum(a.minutos), 0)::int) as partida_estimada,
           v.chegada_prevista + make_interval(mins => coalesce(sum(a.minutos), 0)::int) as chegada_estimada
      from voo v
      left join atraso a on a.voo_id = v.id
     group by v.id
  ) r;

-- Como os relatórios ficariam do jeito antigo (pelo sintoma)
create view vw_minutos_por_sintoma as
select partida_prevista::date as data, sintoma_codigo as codigo,
       sintoma_descricao as descricao,
       count(*)::int as ocorrencias, sum(minutos)::int as minutos
  from vw_atraso_detalhado
 group by 1, 2, 3;

-- Como ficam com a solução (pela causa raiz)
create view vw_minutos_por_causa_raiz as
select partida_prevista::date as data, causa_raiz_codigo as codigo,
       causa_raiz_descricao as descricao, causa_raiz_area as area,
       count(*)::int as ocorrencias, sum(minutos)::int as minutos
  from vw_atraso_detalhado
 group by 1, 2, 3, 4;


-- ---------------------------------------------------------------------
-- ACESSO: funcionários (código de identificação) e passageiros (e-mail)
-- As senhas são guardadas com hash bcrypt (extensão pgcrypto).
-- ---------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table funcionario (
    id         serial primary key,
    codigo     text not null unique,        -- ex.: AL-1001
    nome       text not null,
    area       text not null,               -- CCO, Aeroporto, Manutenção...
    senha_hash text not null
);

create table passageiro (
    id         serial primary key,
    nome       text not null,
    email      text not null unique,
    senha_hash text not null,
    criado_em  timestamp not null default now()
);

create table sessao (
    token          uuid primary key default gen_random_uuid(),
    funcionario_id int references funcionario(id) on delete cascade,
    passageiro_id  int references passageiro(id)  on delete cascade,
    expira_em      timestamp not null,
    check ((funcionario_id is null) <> (passageiro_id is null))
);

-- voos que cada passageiro acompanha
create table passageiro_voo (
    passageiro_id int not null references passageiro(id) on delete cascade,
    voo_id        int not null references voo(id) on delete cascade,
    primary key (passageiro_id, voo_id)
);

create function funcionario_da_sessao(p_token uuid)
returns funcionario
language plpgsql security definer set search_path = public
as $$
declare
    v funcionario;
begin
    select f.* into v from sessao s join funcionario f on f.id = s.funcionario_id
     where s.token = p_token and s.expira_em > now();
    if not found then
        if exists (select 1 from sessao where token = p_token and passageiro_id is not null) then
            raise exception 'Acesso restrito a funcionários.';
        end if;
        raise exception 'Sessão expirada. Entre novamente.';
    end if;
    return v;
end;
$$;

create function passageiro_da_sessao(p_token uuid)
returns passageiro
language plpgsql security definer set search_path = public
as $$
declare
    v passageiro;
begin
    select p.* into v from sessao s join passageiro p on p.id = s.passageiro_id
     where s.token = p_token and s.expira_em > now();
    if not found then
        raise exception 'Sessão expirada. Entre novamente.';
    end if;
    return v;
end;
$$;

create function cadastrar_passageiro(p_nome text, p_email text, p_senha text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
    v_id    int;
    v_token uuid;
begin
    if length(trim(p_nome)) < 2 then raise exception 'Informe seu nome.'; end if;
    if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Informe um e-mail válido.'; end if;
    if length(p_senha) < 6 then raise exception 'A senha precisa ter pelo menos 6 caracteres.'; end if;
    if exists (select 1 from passageiro where email = lower(trim(p_email))) then
        raise exception 'Já existe uma conta com este e-mail. Entre com sua senha.';
    end if;

    insert into passageiro (nome, email, senha_hash)
    values (trim(p_nome), lower(trim(p_email)), crypt(p_senha, gen_salt('bf')))
    returning id into v_id;

    insert into sessao (passageiro_id, expira_em) values (v_id, now() + interval '30 days')
    returning token into v_token;
    return v_token;
end;
$$;

create function entrar_passageiro(p_email text, p_senha text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
    v_p     passageiro;
    v_token uuid;
begin
    select * into v_p from passageiro where email = lower(trim(p_email));
    if not found or v_p.senha_hash <> crypt(p_senha, v_p.senha_hash) then
        raise exception 'E-mail ou senha incorretos.';
    end if;
    insert into sessao (passageiro_id, expira_em) values (v_p.id, now() + interval '30 days')
    returning token into v_token;
    return v_token;
end;
$$;

create function entrar_funcionario(p_codigo text, p_senha text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
    v_f     funcionario;
    v_token uuid;
begin
    select * into v_f from funcionario where codigo = upper(trim(p_codigo));
    if not found or v_f.senha_hash <> crypt(p_senha, v_f.senha_hash) then
        raise exception 'Código de identificação ou senha incorretos.';
    end if;
    insert into sessao (funcionario_id, expira_em) values (v_f.id, now() + interval '12 hours')
    returning token into v_token;
    return v_token;
end;
$$;

-- Quem está logado (usado pelas páginas ao abrir)
create function sessao_atual(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
    select case
        when s.funcionario_id is not null then
            jsonb_build_object('tipo', 'FUNCIONARIO', 'nome', f.nome, 'codigo', f.codigo, 'area', f.area)
        else
            jsonb_build_object('tipo', 'PASSAGEIRO', 'nome', p.nome, 'email', p.email)
        end
      from sessao s
      left join funcionario f on f.id = s.funcionario_id
      left join passageiro  p on p.id = s.passageiro_id
     where s.token = p_token and s.expira_em > now();
$$;

create function sair(p_token uuid)
returns void
language sql security definer set search_path = public
as $$ delete from sessao where token = p_token $$;

-- ---------------------------------------------------------------------
-- ÁREA DO PASSAGEIRO
-- ---------------------------------------------------------------------

-- Traduz a causa raiz para uma frase que o passageiro entende
create function motivo_para_cliente(p_categoria text)
returns text
language sql immutable
as $$
    select case p_categoria
        when 'Técnico'               then 'manutenção na aeronave'
        when 'Meteorologia'          then 'condições do tempo'
        when 'Tráfego aéreo'         then 'restrição do controle de tráfego aéreo'
        when 'Tripulação'            then 'ajuste na escala da tripulação'
        when 'Passageiros e bagagem' then 'embarque de passageiros e bagagens'
        when 'Solo'                  then 'serviços de solo no aeroporto'
        when 'Aeroporto'             then 'infraestrutura do aeroporto'
        else 'questões operacionais'
    end
$$;

create function meus_voos(p_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
    v_p passageiro;
begin
    v_p := passageiro_da_sessao(p_token);
    return jsonb_build_object('agora', agora(), 'voos', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'fase', r.fase,
                 'voo_id', r.id,
                 'numero', r.numero,
                 'origem', r.origem,
                 'destino', r.destino,
                 'partida_prevista', r.partida_prevista,
                 'chegada_prevista', r.chegada_prevista,
                 'atraso', r.atraso_total,
                 'partida_estimada', r.partida_estimada,
                 'chegada_estimada', r.chegada_estimada,
                 'motivo', mot.frase)
               order by r.partida_prevista)
          from passageiro_voo pv
          join vw_voo_resumo r on r.id = pv.voo_id
          left join lateral (
               -- causa principal: a raiz que mais somou minutos neste voo
               select case
                        when bool_or(d.tipo = 'CONSEQUENTE') and not bool_or(d.tipo = 'ORIGINADOR' and d.raiz_id = d.id)
                          then 'O avião deste voo chega de um voo anterior que atrasou por '
                               || motivo_para_cliente(max(d.causa_raiz_categoria)) || '.'
                        else 'Motivo: ' || motivo_para_cliente(max(d.causa_raiz_categoria)) || '.'
                      end as frase
                 from vw_atraso_detalhado d
                where d.voo_id = r.id
                group by d.raiz_id
                order by sum(d.minutos) desc
                limit 1) mot on true
         where pv.passageiro_id = v_p.id), '[]'::jsonb));
end;
$$;

-- Passageiro passa a acompanhar um voo pelo número (usa a próxima data disponível)
create function acompanhar_voo(p_token uuid, p_numero text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
    v_p   passageiro;
    v_voo int;
begin
    v_p := passageiro_da_sessao(p_token);
    select id into v_voo from voo
     where numero = upper(replace(trim(p_numero), ' ', ''))
     order by (partida_prevista < now()::date), abs(extract(epoch from partida_prevista - now()))
     limit 1;
    if v_voo is null then
        raise exception 'Não encontramos o voo %. Confira o número no seu cartão de embarque.', upper(trim(p_numero));
    end if;
    insert into passageiro_voo values (v_p.id, v_voo) on conflict do nothing;
end;
$$;

create function deixar_de_acompanhar(p_token uuid, p_voo_id int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
    v_p passageiro;
begin
    v_p := passageiro_da_sessao(p_token);
    delete from passageiro_voo where passageiro_id = v_p.id and voo_id = p_voo_id;
end;
$$;

-- ---------------------------------------------------------------------
-- ÁREA DO FUNCIONÁRIO: as mesmas ações de antes, agora exigindo login
-- ---------------------------------------------------------------------
create function op_registrar_atraso(p_token uuid, p_voo_id int, p_motivo text, p_minutos int, p_observacao text default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
    v_f  funcionario;
    v_id int;
begin
    v_f := funcionario_da_sessao(p_token);
    if (select fase from vw_voo_resumo where id = p_voo_id) in ('EM_VOO', 'POUSOU') then
        raise exception 'Este voo já decolou. Registre o atraso em um voo que ainda não partiu.';
    end if;
    v_id := registrar_atraso(p_voo_id, p_motivo, p_minutos, p_observacao);
    update atraso set registrado_por = v_f.nome || ' (' || v_f.codigo || ')' where id = v_id;
    return v_id;
end;
$$;

create function op_remover_atraso(p_token uuid, p_atraso_id int)
returns void
language plpgsql security definer set search_path = public
as $$
begin
    perform funcionario_da_sessao(p_token);
    perform remover_atraso(p_atraso_id);
end;
$$;

create function op_registrar_parecer(p_token uuid, p_atraso_id int, p_area text, p_motivo text, p_justificativa text default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
    v_f  funcionario;
    v_id int;
begin
    v_f := funcionario_da_sessao(p_token);
    v_id := registrar_parecer(p_atraso_id, p_area, p_motivo, p_justificativa);
    update parecer set funcionario = v_f.nome where id = v_id;
    return v_id;
end;
$$;

create function op_validar_atraso(p_token uuid, p_atraso_id int, p_motivo_final text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
    perform funcionario_da_sessao(p_token);
    perform validar_atraso(p_atraso_id, p_motivo_final);
end;
$$;


-- ---------------------------------------------------------------------
-- SIMULAÇÃO DO DIA
-- Os problemas do dia ficam programados em evento_simulado e só
-- "acontecem" quando o relógio chega no horário deles. Assim a
-- demonstração mostra o atraso surgindo e se propagando ao vivo.
-- ---------------------------------------------------------------------
create table evento_simulado (
    id          serial primary key,
    acontece_em timestamp not null,
    tipo        text not null check (tipo in ('ATRASO', 'PARECER', 'VALIDACAO')),
    voo_numero  text not null,             -- voo onde o problema acontece
    motivo      text not null references motivo(codigo),
    minutos     int,                       -- só para ATRASO
    area        text,                      -- só para PARECER
    texto       text,                      -- observação ou justificativa
    autor       text not null,
    aplicado    boolean not null default false
);

-- Aplica os eventos cujo horário já chegou. Devolve o que aconteceu.
create function aplicar_eventos()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
    e      record;
    v_voo  int;
    v_orig int;
    v_id   int;
    v_log  jsonb := '[]'::jsonb;
begin
    for e in
        select * from evento_simulado
         where not aplicado and acontece_em <= agora()
         order by acontece_em, id
    loop
        select id into v_voo from voo where numero = e.voo_numero;
        select id into v_orig from atraso
         where voo_id = v_voo and tipo = 'ORIGINADOR' and motivo_codigo <> '93'
         order by id desc limit 1;

        if e.tipo = 'ATRASO' then
            v_id := registrar_atraso(v_voo, e.motivo, e.minutos, e.texto);
            update atraso set registrado_em = e.acontece_em, registrado_por = e.autor where id = v_id;
            v_log := v_log || jsonb_build_object('hora', to_char(e.acontece_em, 'HH24:MI'),
                     'texto', e.voo_numero || ' atrasou ' || e.minutos || ' min: ' ||
                              (select descricao from motivo where codigo = e.motivo));
        elsif e.tipo = 'PARECER' and v_orig is not null then
            v_id := registrar_parecer(v_orig, e.area, e.motivo, e.texto);
            update parecer set criado_em = e.acontece_em, funcionario = e.autor where id = v_id;
            v_log := v_log || jsonb_build_object('hora', to_char(e.acontece_em, 'HH24:MI'),
                     'texto', e.area || ' deu parecer sobre o atraso do ' || e.voo_numero);
        elsif e.tipo = 'VALIDACAO' and v_orig is not null then
            perform validar_atraso(v_orig, e.motivo);
            v_log := v_log || jsonb_build_object('hora', to_char(e.acontece_em, 'HH24:MI'),
                     'texto', 'Causa oficial do atraso do ' || e.voo_numero || ' validada');
        end if;

        update evento_simulado set aplicado = true where id = e.id;
    end loop;
    return v_log;
end;
$$;

-- Avança o relógio (somente funcionários)
create function avancar_relogio(p_token uuid, p_minutos int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
    v_log jsonb;
begin
    perform funcionario_da_sessao(p_token);
    if p_minutos not between 1 and 240 then
        raise exception 'Avance entre 1 e 240 minutos por vez.';
    end if;
    update relogio set agora = agora + make_interval(mins => p_minutos) where id = 1;
    v_log := aplicar_eventos();
    return jsonb_build_object('agora', agora(), 'eventos', v_log);
end;
$$;

-- Volta o dia para 06:00 e desfaz tudo o que aconteceu (somente funcionários)
create function reiniciar_simulacao(p_token uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
    perform funcionario_da_sessao(p_token);
    delete from parecer where true;
    delete from atraso where true;
    update evento_simulado set aplicado = false where true;
    update relogio set agora = '2026-10-05 06:00' where id = 1;
end;
$$;

-- ---------------------------------------------------------------------
-- SEGURANÇA (Supabase)
-- O site usa a chave pública "anon": pode LER tudo, mas só ALTERA
-- dados pelas funções acima, que aplicam as regras de negócio.
-- ---------------------------------------------------------------------
alter table configuracao enable row level security;
alter table aeronave     enable row level security;
alter table motivo       enable row level security;
alter table voo          enable row level security;
alter table atraso       enable row level security;
alter table parecer      enable row level security;

create policy leitura_publica on configuracao for select using (true);
create policy leitura_publica on aeronave     for select using (true);
create policy leitura_publica on motivo       for select using (true);
create policy leitura_publica on voo          for select using (true);
create policy leitura_publica on atraso       for select using (true);
create policy leitura_publica on parecer      for select using (true);

alter table funcionario    enable row level security;   -- sem política: ninguém lê direto
alter table passageiro     enable row level security;
alter table sessao         enable row level security;
alter table passageiro_voo enable row level security;
alter table evento_simulado enable row level security;   -- o futuro não é visível
alter table relogio        enable row level security;
create policy leitura_publica on relogio for select using (true);

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
revoke all on funcionario, passageiro, sessao, passageiro_voo, evento_simulado from anon, authenticated;

-- funções internas: só o próprio banco usa
revoke execute on all functions in schema public from public, anon, authenticated;

-- o que o site pode chamar
grant execute on function cadeia_atraso(int)                               to anon, authenticated;
grant execute on function cadastrar_passageiro(text, text, text)           to anon, authenticated;
grant execute on function entrar_passageiro(text, text)                    to anon, authenticated;
grant execute on function entrar_funcionario(text, text)                   to anon, authenticated;
grant execute on function sessao_atual(uuid)                               to anon, authenticated;
grant execute on function sair(uuid)                                       to anon, authenticated;
grant execute on function meus_voos(uuid)                                  to anon, authenticated;
grant execute on function acompanhar_voo(uuid, text)                       to anon, authenticated;
grant execute on function deixar_de_acompanhar(uuid, int)                 to anon, authenticated;
grant execute on function op_registrar_atraso(uuid, int, text, int, text)  to anon, authenticated;
grant execute on function op_remover_atraso(uuid, int)                     to anon, authenticated;
grant execute on function op_registrar_parecer(uuid, int, text, text, text) to anon, authenticated;
grant execute on function op_validar_atraso(uuid, int, text)               to anon, authenticated;
grant execute on function agora()                                          to anon, authenticated;
grant execute on function avancar_relogio(uuid, int)                       to anon, authenticated;
grant execute on function reiniciar_simulacao(uuid)                        to anon, authenticated;

-- As views respeitam as permissões de quem consulta
alter view vw_atraso_detalhado       set (security_invoker = true);
alter view vw_voo_resumo             set (security_invoker = true);
alter view vw_minutos_por_sintoma    set (security_invoker = true);
alter view vw_minutos_por_causa_raiz set (security_invoker = true);
