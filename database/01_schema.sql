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

    insert into atraso (voo_id, motivo_codigo, minutos, tipo, observacao)
    values (p_voo_id, p_motivo, p_minutos, 'ORIGINADOR', p_observacao)
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
select v.id, v.numero, v.matricula, v.origem, v.destino,
       v.partida_prevista, v.chegada_prevista,
       coalesce(sum(a.minutos), 0)::int as atraso_total,
       coalesce(sum(a.minutos) filter (where a.tipo = 'CONSEQUENTE'), 0)::int as atraso_herdado,
       coalesce(sum(a.minutos) filter (where a.tipo = 'ORIGINADOR'),  0)::int as atraso_novo,
       v.partida_prevista + make_interval(mins => coalesce(sum(a.minutos), 0)::int) as partida_estimada
  from voo v
  left join atraso a on a.voo_id = v.id
 group by v.id;

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

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant execute on function registrar_atraso(int, text, int, text) to anon, authenticated;
grant execute on function remover_atraso(int)                    to anon, authenticated;
grant execute on function registrar_parecer(int, text, text, text) to anon, authenticated;
grant execute on function validar_atraso(int, text)              to anon, authenticated;
grant execute on function cadeia_atraso(int)                     to anon, authenticated;
revoke execute on function propagar_atrasos(text, date) from public, anon, authenticated;

-- As views respeitam as permissões de quem consulta
alter view vw_atraso_detalhado       set (security_invoker = true);
alter view vw_voo_resumo             set (security_invoker = true);
alter view vw_minutos_por_sintoma    set (security_invoker = true);
alter view vw_minutos_por_causa_raiz set (security_invoker = true);
