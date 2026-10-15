drop trigger  if exists atraso_aprender on atraso;
drop function if exists aprender_com_atraso() cascade;
drop view     if exists vw_modelo_palavra cascade;
drop view     if exists vw_modelo_motivo  cascade;
drop function if exists palavras_do_texto(text) cascade;
drop table    if exists exemplo_motivo cascade;
drop table    if exists palavra_vazia  cascade;

create table palavra_vazia (
    palavra text primary key
);

insert into palavra_vazia (palavra) values
('com'), ('sem'), ('para'), ('pra'), ('por'), ('pelo'), ('pela'), ('pelos'), ('pelas'),
('das'), ('dos'), ('nas'), ('nos'), ('num'), ('numa'), ('uma'), ('uns'), ('umas'),
('que'), ('foi'), ('era'), ('esta'), ('estava'), ('ficou'), ('tem'), ('teve'), ('houve'),
('aos'), ('mas'), ('mais'), ('muito'), ('muita'), ('bem'), ('ainda'), ('ja'), ('apos'),
('antes'), ('depois'), ('durante'), ('entre'), ('sobre'), ('ate'), ('desde'), ('porque'),
('voo'), ('voos'), ('atraso'), ('atrasou'), ('aeronave'), ('aviao'),
('nao'), ('sim'), ('tinha'), ('ter'), ('ser'), ('sao'), ('isso'), ('esse'), ('essa'),
('este'), ('aqui'), ('ali'), ('hoje'), ('agora'), ('quando'), ('onde'), ('como'), ('qual'),
('nenhum'), ('nenhuma'), ('algum'), ('alguma'), ('todo'), ('toda'), ('todos'), ('todas'),
('pouco'), ('pouca'), ('outro'), ('outra'), ('vai'), ('vou'), ('fez'), ('fazer'), ('deu'), ('dar');

create table exemplo_motivo (
    id            serial primary key,
    motivo_codigo text not null references motivo(codigo) on delete cascade,
    texto         text not null,
    origem        text not null check (origem in ('INICIAL', 'CONFIRMADO')),
    atraso_id     int unique,
    criado_em     timestamp not null default now()
);

create function palavras_do_texto(p_texto text)
returns setof text
language sql stable
set search_path = public
as $$
    select distinct case when length(p) > 4 and right(p, 1) = 's' then left(p, -1) else p end
      from regexp_split_to_table(
               translate(lower(coalesce(p_texto, '')),
                         'áàâãäéèêëíìîïóòôõöúùûüç',
                         'aaaaaeeeeiiiiooooouuuuc'),
               '[^a-z0-9]+') as p
     where length(p) >= 3
       and p not in (select palavra from palavra_vazia);
$$;

create view vw_modelo_palavra as
select p.palavra, e.motivo_codigo, count(*)::int as contagem
  from exemplo_motivo e
 cross join lateral palavras_do_texto(e.texto) as p(palavra)
 group by p.palavra, e.motivo_codigo;

create view vw_modelo_motivo as
select m.codigo as motivo_codigo,
       count(e.id)::int                                         as exemplos,
       (count(e.id) filter (where e.origem = 'CONFIRMADO'))::int as confirmados
  from motivo m
  left join exemplo_motivo e on e.motivo_codigo = m.codigo
 where not m.reativo
 group by m.codigo;

create function aprender_com_atraso()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if new.observacao is null or btrim(new.observacao) = '' then
        return new;
    end if;
    insert into exemplo_motivo (motivo_codigo, texto, origem, atraso_id)
    values (new.motivo_codigo, new.observacao, 'CONFIRMADO', new.id)
    on conflict (atraso_id) do update
       set motivo_codigo = excluded.motivo_codigo,
           texto         = excluded.texto,
           criado_em     = now();
    return new;
end;
$$;

create trigger atraso_aprender
after update on atraso
for each row
when (new.status = 'VALIDADO' and new.tipo = 'ORIGINADOR'
      and (old.status <> 'VALIDADO'
           or old.motivo_codigo <> new.motivo_codigo
           or old.observacao is distinct from new.observacao))
execute function aprender_com_atraso();

insert into exemplo_motivo (motivo_codigo, texto, origem) values
('11', 'Fila grande no check-in, passageiros chegaram em cima da hora', 'INICIAL'),
('11', 'Sistema de check-in lento no balcão', 'INICIAL'),
('11', 'Aguardando passageiros atrasados no portão de embarque', 'INICIAL'),
('11', 'Passageiros em conexão ainda fazendo check-in', 'INICIAL'),
('11', 'Grupo grande chegou tarde ao balcão de atendimento', 'INICIAL'),

('18', 'Esteira de bagagem quebrada', 'INICIAL'),
('18', 'Carregamento das malas no porão demorou', 'INICIAL'),
('18', 'Retirada de bagagem de passageiro que não embarcou', 'INICIAL'),
('18', 'Muitas malas de mão despachadas no portão', 'INICIAL'),
('18', 'Volume de bagagens acima do previsto', 'INICIAL'),

('33', 'Trator de reboque indisponível no pátio', 'INICIAL'),
('33', 'Escada de embarque não chegou à aeronave', 'INICIAL'),
('33', 'GPU com defeito, sem energia externa em solo', 'INICIAL'),
('33', 'Loader de carga quebrado', 'INICIAL'),
('33', 'Falta de equipamento de rampa para carregar', 'INICIAL'),

('36', 'Caminhão de abastecimento atrasou', 'INICIAL'),
('36', 'Abastecimento de combustível demorado', 'INICIAL'),
('36', 'Fila para abastecer querosene no pátio', 'INICIAL'),
('36', 'Falta de combustível no aeroporto', 'INICIAL'),
('36', 'Pedido de combustível extra feito tarde', 'INICIAL'),
('36', 'Sem gasolina, tanque vazio aguardando abastecer', 'INICIAL'),
('36', 'Combustível acabou e o caminhão tanque não chegou', 'INICIAL'),
('36', 'Falta de gasolina de aviação no posto do aeroporto', 'INICIAL'),

('41', 'Pane no motor detectada no pré-voo', 'INICIAL'),
('41', 'Falha no sistema hidráulico', 'INICIAL'),
('41', 'Pneu furado encontrado na inspeção', 'INICIAL'),
('41', 'Luz de alerta acesa no painel, manutenção chamada', 'INICIAL'),
('41', 'Troca de peça com defeito pela equipe técnica', 'INICIAL'),
('41', 'Problema no freio do trem de pouso', 'INICIAL'),

('63', 'Copiloto chegou atrasado ao aeroporto', 'INICIAL'),
('63', 'Tripulação presa no trânsito', 'INICIAL'),
('63', 'Comandante passou mal e foi substituído', 'INICIAL'),
('63', 'Escala de tripulação incompleta', 'INICIAL'),
('63', 'Piloto excedeu a jornada e precisou de reserva', 'INICIAL'),

('71', 'Chuva forte com raios sobre o aeroporto', 'INICIAL'),
('71', 'Nevoeiro e visibilidade baixa', 'INICIAL'),
('71', 'Tempestade na região de decolagem', 'INICIAL'),
('71', 'Vento forte de través na pista', 'INICIAL'),
('71', 'Formação de gelo e tempo ruim', 'INICIAL'),

('81', 'Controle de tráfego segurou a decolagem', 'INICIAL'),
('81', 'Fluxo restrito no espaço aéreo', 'INICIAL'),
('81', 'Espera em solo determinada pelo controle', 'INICIAL'),
('81', 'Slot de decolagem atrasado pela torre', 'INICIAL'),
('81', 'Congestionamento de aeronaves para decolar', 'INICIAL'),

('87', 'Ponte de embarque inoperante', 'INICIAL'),
('87', 'Falta de energia no terminal', 'INICIAL'),
('87', 'Pista interditada para obras', 'INICIAL'),
('87', 'Pátio lotado, sem posição para estacionar', 'INICIAL'),
('87', 'Sistema do aeroporto fora do ar', 'INICIAL');

alter table palavra_vazia  enable row level security;
alter table exemplo_motivo enable row level security;
create policy leitura_publica on palavra_vazia  for select using (true);
create policy leitura_publica on exemplo_motivo for select using (true);

grant select on palavra_vazia, exemplo_motivo, vw_modelo_palavra, vw_modelo_motivo to anon, authenticated;
revoke execute on function aprender_com_atraso() from public, anon, authenticated;
grant execute on function palavras_do_texto(text) to anon, authenticated;

alter view vw_modelo_palavra set (security_invoker = true);
alter view vw_modelo_motivo  set (security_invoker = true);
