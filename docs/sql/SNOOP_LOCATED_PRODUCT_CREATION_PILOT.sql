-- SNOOP inventory locations: safe product creation with placement.
-- Existing products.stock stays the total, existing location trigger assigns initial
-- product quantities to dispensario; same transaction then moves to almacen when requested.
-- No data backfill, no changes to orders, Caja, existing stock triggers or roles.
begin;
create table if not exists public.snoop_located_product_requests(
  club_id uuid not null references public.clubs(id) on delete restrict,
  request_id uuid not null,
  product_id uuid not null references public.products(id) on delete restrict,
  destination text not null check(destination in ('almacen','dispensario')),
  payload jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(club_id,request_id)
);
alter table public.snoop_located_product_requests enable row level security;
revoke all on public.snoop_located_product_requests from public,anon,authenticated;
create or replace function public.snoop_create_product_located(
 p_values jsonb,p_destination text,p_request_id uuid
) returns uuid language plpgsql security definer set search_path='' as $located$
declare c uuid; v_product uuid; v_initial numeric; v_previous public.snoop_located_product_requests;
begin
 c:=public.current_club_id();
 if auth.uid() is null or c is null or not public.can_manage_snoop_catalog(c)
 then raise exception 'Inventario no autorizado' using errcode='42501';end if;
 if p_request_id is null or p_destination not in ('almacen','dispensario') or
  p_values is null or jsonb_typeof(p_values)<>'object'
 then raise exception 'Ubicación o solicitud no válida' using errcode='22023';end if;
 v_initial:=(p_values->>'stock')::numeric;
 if v_initial is null or v_initial<0 or v_initial>1000000 or v_initial<>round(v_initial,2)
 then raise exception 'Cantidad inicial no válida' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text||p_request_id::text,0));
 select * into v_previous from public.snoop_located_product_requests where club_id=c and request_id=p_request_id;
 if found then
   if v_previous.created_by=auth.uid() and v_previous.destination=p_destination and v_previous.payload=p_values
   then return v_previous.product_id;end if;
   raise exception 'Solicitud reutilizada con distintos datos' using errcode='23505';
 end if;
 v_product:=public.save_administrative_product(null,p_values);
 if p_destination='almacen' and v_initial>0 then
   perform public.snoop_transfer_stock(v_product,v_initial,'dispensario','almacen',p_request_id);
 end if;
 insert into public.snoop_located_product_requests(club_id,request_id,product_id,destination,payload,created_by)
 values(c,p_request_id,v_product,p_destination,p_values,auth.uid());
 return v_product;
end $located$;
revoke all on function public.snoop_create_product_located(jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.snoop_create_product_located(jsonb,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
