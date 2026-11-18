-- Disposable CI only: minimal stand-ins for production SNOOP's transaction RPCs.
-- These mimic the order/stock/cancellation contract, NOT its full security model.
\set ON_ERROR_STOP on
create table public.products(
 id uuid primary key,club_id uuid not null,name text not null,
 sell_price numeric not null,active boolean not null default true
);
insert into public.products(id,club_id,name,sell_price,active)
values('deafbeef-1111-4222-8333-444444444444',
 '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc','Synthetic',8.00,true);
create table public.wallet_test_stock(product_id uuid primary key, remaining integer not null check(remaining>=0));
insert into public.wallet_test_stock values('deafbeef-1111-4222-8333-444444444444',10);
create function public.current_club_id()
returns uuid language sql stable security definer set search_path=''
as $$
 select case when auth.uid()='7dbe4ead-c904-4c52-9fc1-51a9018aeb22'::uuid
 then '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc'::uuid else null end
$$;
create function public.can_operate_club(p_club uuid,p_permission text)
returns boolean language sql stable security definer set search_path=''
as $$
 select auth.uid()='7dbe4ead-c904-4c52-9fc1-51a9018aeb22'::uuid
 and p_club='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc'::uuid
 and p_permission in ('use_cash','manage_members')
$$;
create function public.create_order_with_items(
 _member_id uuid,_notes text,_items jsonb
) returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid:=gen_random_uuid();v_total integer:=0;item jsonb;v_qty integer;
begin
 for item in select * from jsonb_array_elements(_items) loop
  v_qty:=(item->>'quantity')::integer;
  update public.wallet_test_stock set remaining=remaining-v_qty
  where product_id=(item->>'product_id')::uuid and remaining>=v_qty;
  if not found then raise exception 'STOCK_UNAVAILABLE' using errcode='23514';end if;
  v_total:=v_total+(item->>'line_total_cents')::integer;
 end loop;
 insert into public.orders(id,club_id,member_id,total_cents,status)
 values(v_id,public.current_club_id(),_member_id,v_total,'completed');
 return v_id;
end;
$$;
create function public.annul_financial_order(
 p_member_id uuid,p_order_id uuid,p_reason text
) returns uuid language plpgsql security definer set search_path=''
as $$
declare v public.orders;v_items integer;
begin
 select * into v from public.orders where id=p_order_id
 and member_id=p_member_id and club_id=public.current_club_id()
 and status='completed' for update;
 if not found then raise exception 'CANNOT_CANCEL' using errcode='23514';end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'REASON_REQUIRED' using errcode='22023';end if;
 update public.orders set status='cancelled',cancelled_at=now() where id=p_order_id;
 insert into public.financial_order_reversals(id,order_id,club_id,original_cents,delta_cents)
 values(gen_random_uuid(),p_order_id,v.club_id,v.total_cents,-v.total_cents);
 -- Synthetic stock restoration: production uses its own protected triggers.
 update public.wallet_test_stock set remaining=remaining+1
 where product_id='deafbeef-1111-4222-8333-444444444444';
 return p_order_id;
end;
$$;
