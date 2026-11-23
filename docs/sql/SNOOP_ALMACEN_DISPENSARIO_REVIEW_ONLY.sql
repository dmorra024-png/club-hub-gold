-- SNOOP warehouse/dispensary split. REVIEW BEFORE APPLYING.
-- Existing total products.stock remains the accounting source of truth.
-- Historical totals start in dispensario; reserve is initially zero.
begin;
create table public.snoop_stock_locations (
 club_id uuid not null references public.clubs(id) on delete restrict,
 product_id uuid not null references public.products(id) on delete restrict,
 location text not null check(location in ('almacen','dispensario')),
 quantity numeric(14,2) not null default 0 check(quantity>=0),
 primary key(club_id,product_id,location)
);
create table public.snoop_stock_transfers (
 id uuid primary key default gen_random_uuid(),
 club_id uuid not null references public.clubs(id) on delete restrict,
 product_id uuid not null references public.products(id) on delete restrict,
 request_id uuid not null,
 from_location text not null check(from_location in ('almacen','dispensario')),
 to_location text not null check(to_location in ('almacen','dispensario')),
 quantity numeric(14,2) not null check(quantity>0),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 check(from_location<>to_location),
 unique(club_id,request_id)
);
create index snoop_stock_transfers_product_recent on public.snoop_stock_transfers(club_id,product_id,created_at desc);
alter table public.snoop_stock_locations enable row level security;
alter table public.snoop_stock_transfers enable row level security;
revoke all on public.snoop_stock_locations,public.snoop_stock_transfers from public,anon,authenticated;
grant select on public.snoop_stock_locations,public.snoop_stock_transfers to authenticated;
create policy snoop_stock_locations_read on public.snoop_stock_locations
 for select to authenticated using (club_id=(select public.current_club_id()) and (public.can_manage_snoop_catalog(club_id) or public.can_operate_club(club_id,'use_cash')));
create policy snoop_stock_transfers_read on public.snoop_stock_transfers
 for select to authenticated using (club_id=(select public.current_club_id()) and public.can_manage_snoop_catalog(club_id));
-- Preserve every legacy total: location-only split, no rewriting of stock or historical movement records.
insert into public.snoop_stock_locations(club_id,product_id,location,quantity)
 select club_id,id,'dispensario',stock from public.products;
-- Legacy orders, reversals and product corrections already emit stock_movements.
-- Apply those movements to the point of dispensación, atomically in the same transaction.
create function public.snoop_apply_stock_location_movement()
returns trigger language plpgsql security definer set search_path='' as $loc$
declare current_qty numeric;
begin
 if NEW.delta is null or NEW.delta=0 then return NEW; end if;
 if not exists(select 1 from public.products p where p.id=NEW.product_id and p.club_id=NEW.club_id)
 then raise exception 'Ubicación de producto no válida' using errcode='42501'; end if;
 insert into public.snoop_stock_locations(club_id,product_id,location,quantity)
 values(NEW.club_id,NEW.product_id,'dispensario',0)
 on conflict do nothing;
 update public.snoop_stock_locations
 set quantity=quantity+NEW.delta
 where club_id=NEW.club_id and product_id=NEW.product_id
  and location='dispensario' and quantity+NEW.delta>=0
 returning quantity into current_qty;
 if not found then
  raise exception 'Stock insuficiente en dispensario. Traslada unidades desde almacén antes de dispensar.'
   using errcode='23514';
 end if;
 return NEW;
end $loc$;
revoke all on function public.snoop_apply_stock_location_movement() from public,anon,authenticated;
create trigger snoop_apply_stock_location_movement
 after insert on public.stock_movements
 for each row execute function public.snoop_apply_stock_location_movement();
-- Product lock serializes transfer with sale, merma and cancellation; no global stock change.
create function public.snoop_transfer_stock(
 p_product_id uuid,p_quantity numeric,p_from text,p_to text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $transfer$
declare c uuid; v_total numeric; v_from numeric; v_to numeric; existing public.snoop_stock_transfers;
begin
 c:=public.current_club_id();
 if auth.uid() is null or c is null or not public.can_manage_snoop_catalog(c)
 then raise exception 'Transferencia no autorizada' using errcode='42501'; end if;
 if p_request_id is null or p_quantity is null or p_quantity<=0 or p_quantity>1000000
  or p_quantity<>round(p_quantity,2) or p_from not in ('almacen','dispensario')
  or p_to not in ('almacen','dispensario') or p_from=p_to
 then raise exception 'Transferencia no válida' using errcode='22023'; end if;
 select stock into v_total from public.products
 where id=p_product_id and club_id=c and active is distinct from false for update;
 if not found then raise exception 'Producto no disponible' using errcode='42501'; end if;
 select * into existing from public.snoop_stock_transfers where club_id=c and request_id=p_request_id;
 if found then
  if existing.product_id=p_product_id and existing.quantity=p_quantity
   and existing.from_location=p_from and existing.to_location=p_to then
    return jsonb_build_object('id',existing.id,'status','already_applied');
  end if;
  raise exception 'Solicitud reutilizada con otros datos' using errcode='23505';
 end if;
 insert into public.snoop_stock_locations(club_id,product_id,location,quantity)
 values(c,p_product_id,'almacen',0),(c,p_product_id,'dispensario',0)
 on conflict do nothing;
 update public.snoop_stock_locations set quantity=quantity-p_quantity
 where club_id=c and product_id=p_product_id and location=p_from and quantity>=p_quantity
 returning quantity into v_from;
 if not found then raise exception 'Cantidad insuficiente en origen' using errcode='23514'; end if;
 update public.snoop_stock_locations set quantity=quantity+p_quantity
 where club_id=c and product_id=p_product_id and location=p_to returning quantity into v_to;
 insert into public.snoop_stock_transfers(club_id,product_id,request_id,from_location,to_location,quantity,created_by)
 values(c,p_product_id,p_request_id,p_from,p_to,p_quantity,auth.uid()) returning * into existing;
 return jsonb_build_object('id',existing.id,'status','applied','from',v_from,'to',v_to,'total',v_total);
end $transfer$;
revoke all on function public.snoop_transfer_stock(uuid,numeric,text,text,uuid) from public,anon;
grant execute on function public.snoop_transfer_stock(uuid,numeric,text,text,uuid) to authenticated;
-- Product creation reuses authoritative catalog validation and ledger insertion.
-- Initial location choice is atomic: if transfer fails, new product rolls back.
create function public.snoop_create_product_located(p_values jsonb,p_location text)
returns uuid language plpgsql security definer set search_path='' as $create$
declare pid uuid; qty numeric;
begin
 if p_location not in ('almacen','dispensario') or p_location is null
 then raise exception 'Selecciona ubicación inicial' using errcode='22023'; end if;
 qty:=(p_values->>'stock')::numeric;
 pid:=public.save_administrative_product(null,p_values);
 if qty>0 and p_location='almacen' then
  perform public.snoop_transfer_stock(pid,qty,'dispensario','almacen',gen_random_uuid());
 end if;
 return pid;
end $create$;
revoke all on function public.snoop_create_product_located(jsonb,text) from public,anon;
grant execute on function public.snoop_create_product_located(jsonb,text) to authenticated;
notify pgrst,'reload schema';
commit;