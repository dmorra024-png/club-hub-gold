begin;
do $guard$ begin
 if exists(select 1 from public.snoop_stock_transfers) then raise exception 'Review previous transfers before precision migration';end if;
end $guard$;
alter table public.snoop_stock_locations alter column quantity type numeric(14,3);
alter table public.snoop_stock_transfers alter column quantity type numeric(14,3);
update public.snoop_stock_locations l set quantity=p.stock
 from public.products p where l.product_id=p.id and l.club_id=p.club_id and l.location='dispensario';
create or replace function public.snoop_transfer_stock(
 p_product_id uuid,p_quantity numeric,p_from text,p_to text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $transfer$
declare c uuid; v_total numeric; v_from numeric; v_to numeric; existing public.snoop_stock_transfers;
begin
 c:=public.current_club_id();
 if auth.uid() is null or c is null or not public.can_manage_snoop_catalog(c)
 then raise exception 'Transferencia no autorizada' using errcode='42501'; end if;
 if p_request_id is null or p_quantity is null or p_quantity<=0 or p_quantity>1000000
  or p_quantity<>round(p_quantity,3) or p_from not in ('almacen','dispensario')
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

do $verify$ begin
 if exists(select 1 from public.products p left join
 (select product_id,sum(quantity) quantity from public.snoop_stock_locations group by product_id) x on x.product_id=p.id
 where p.stock is distinct from coalesce(x.quantity,0))
 then raise exception 'Warehouse stock mismatch'; end if;
end $verify$;
notify pgrst,'reload schema';
commit;