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
    minutos       int check (minutos > 0),
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
    insert into exemplo_motivo (motivo_codigo, texto, minutos, origem, atraso_id)
    values (new.motivo_codigo, new.observacao, new.minutos, 'CONFIRMADO', new.id)
    on conflict (atraso_id) do update
       set motivo_codigo = excluded.motivo_codigo,
           texto         = excluded.texto,
           minutos       = excluded.minutos,
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

insert into exemplo_motivo (motivo_codigo, texto, minutos, origem) values
('11', 'Fila grande no check-in, passageiros chegaram em cima da hora', 15, 'INICIAL'),
('11', 'Sistema de check-in lento no balcão', 10, 'INICIAL'),
('11', 'Aguardando passageiros atrasados no portão de embarque', 10, 'INICIAL'),
('11', 'Passageiros em conexão ainda fazendo check-in', 20, 'INICIAL'),
('11', 'Grupo grande chegou tarde ao balcão de atendimento', 15, 'INICIAL'),

('18', 'Esteira de bagagem quebrada', 20, 'INICIAL'),
('18', 'Carregamento das malas no porão demorou', 15, 'INICIAL'),
('18', 'Retirada de bagagem de passageiro que não embarcou', 25, 'INICIAL'),
('18', 'Muitas malas de mão despachadas no portão', 10, 'INICIAL'),
('18', 'Volume de bagagens acima do previsto', 15, 'INICIAL'),

('33', 'Trator de reboque indisponível no pátio', 20, 'INICIAL'),
('33', 'Escada de embarque não chegou à aeronave', 15, 'INICIAL'),
('33', 'GPU com defeito, sem energia externa em solo', 30, 'INICIAL'),
('33', 'Loader de carga quebrado', 25, 'INICIAL'),
('33', 'Falta de equipamento de rampa para carregar', 20, 'INICIAL'),

('36', 'Caminhão de abastecimento atrasou', 25, 'INICIAL'),
('36', 'Abastecimento de combustível demorado', 20, 'INICIAL'),
('36', 'Fila para abastecer querosene no pátio', 20, 'INICIAL'),
('36', 'Falta de combustível no aeroporto', 45, 'INICIAL'),
('36', 'Pedido de combustível extra feito tarde', 15, 'INICIAL'),
('36', 'Sem gasolina, tanque vazio aguardando abastecer', 35, 'INICIAL'),
('36', 'Combustível acabou e o caminhão tanque não chegou', 40, 'INICIAL'),
('36', 'Falta de gasolina de aviação no posto do aeroporto', 45, 'INICIAL'),

('41', 'Pane no motor detectada no pré-voo', 90, 'INICIAL'),
('41', 'Falha no sistema hidráulico', 75, 'INICIAL'),
('41', 'Pneu furado encontrado na inspeção', 45, 'INICIAL'),
('41', 'Luz de alerta acesa no painel, manutenção chamada', 40, 'INICIAL'),
('41', 'Troca de peça com defeito pela equipe técnica', 60, 'INICIAL'),
('41', 'Problema no freio do trem de pouso', 55, 'INICIAL'),

('63', 'Copiloto chegou atrasado ao aeroporto', 25, 'INICIAL'),
('63', 'Tripulação presa no trânsito', 30, 'INICIAL'),
('63', 'Comandante passou mal e foi substituído', 60, 'INICIAL'),
('63', 'Escala de tripulação incompleta', 45, 'INICIAL'),
('63', 'Piloto excedeu a jornada e precisou de reserva', 50, 'INICIAL'),

('71', 'Chuva forte com raios sobre o aeroporto', 40, 'INICIAL'),
('71', 'Nevoeiro e visibilidade baixa', 35, 'INICIAL'),
('71', 'Tempestade na região de decolagem', 50, 'INICIAL'),
('71', 'Vento forte de través na pista', 25, 'INICIAL'),
('71', 'Formação de gelo e tempo ruim', 45, 'INICIAL'),

('81', 'Controle de tráfego segurou a decolagem', 20, 'INICIAL'),
('81', 'Fluxo restrito no espaço aéreo', 15, 'INICIAL'),
('81', 'Espera em solo determinada pelo controle', 25, 'INICIAL'),
('81', 'Slot de decolagem atrasado pela torre', 20, 'INICIAL'),
('81', 'Congestionamento de aeronaves para decolar', 15, 'INICIAL'),

('87', 'Ponte de embarque inoperante', 20, 'INICIAL'),
('87', 'Falta de energia no terminal', 45, 'INICIAL'),
('87', 'Pista interditada para obras', 30, 'INICIAL'),
('87', 'Pátio lotado, sem posição para estacionar', 20, 'INICIAL'),
('87', 'Sistema do aeroporto fora do ar', 35, 'INICIAL');

alter table palavra_vazia  enable row level security;
alter table exemplo_motivo enable row level security;
create policy leitura_publica on palavra_vazia  for select using (true);
create policy leitura_publica on exemplo_motivo for select using (true);

grant select on palavra_vazia, exemplo_motivo, vw_modelo_palavra, vw_modelo_motivo to anon, authenticated;
revoke execute on function aprender_com_atraso() from public, anon, authenticated;
grant execute on function palavras_do_texto(text) to anon, authenticated;

alter view vw_modelo_palavra set (security_invoker = true);
alter view vw_modelo_motivo  set (security_invoker = true);
