-- SNOOP Finance v1. Additive only: no changes to existing Caja, orders, stock or Socio.
begin;
create table if not exists public.snoop_suppliers (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  name text not null check (length(btrim(name)) between 2 and 160),
  contact text not null default '' check (length(contact)<=300),
  notes text not null default '' check (length(notes)<=1000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(club_id,id)
);
create table if not exists public.snoop_expenses (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  request_id uuid not null,
  supplier_id uuid null,
  category text not null check(category in ('alquiler','suministros','personal','mantenimiento','compras','otros')),
  description text not null check(length(btrim(description)) between 3 and 500),
  amount_cents integer not null check(amount_cents>0 and amount_cents<=100000000),
  payment_method text not null check(payment_method in ('efectivo','banco','pendiente')),
  occurred_on date not null default current_date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancel_reason text,
  unique(club_id,request_id),
  unique(club_id,id),
  foreign key (club_id,supplier_id) references public.snoop_suppliers(club_id,id)
);
create table if not exists public.snoop_purchases (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  request_id uuid not null,
  supplier_id uuid not null,
  reference text not null default '' check(length(reference)<=120),
  description text not null check(length(btrim(description)) between 3 and 500),
  amount_cents integer not null check(amount_cents>0 and amount_cents<=100000000),
  status text not null default 'pendiente' check(status in ('pendiente','recibido','cancelado')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(club_id,request_id),
  foreign key (club_id,supplier_id) references public.snoop_suppliers(club_id,id)
);
create index if not exists snoop_expenses_club_date on public.snoop_expenses(club_id,occurred_on desc);
create index if not exists snoop_purchases_club_date on public.snoop_purchases(club_id,created_at desc);
create index if not exists snoop_suppliers_club on public.snoop_suppliers(club_id,name);
alter table public.snoop_suppliers enable row level security;
alter table public.snoop_expenses enable row level security;
alter table public.snoop_purchases enable row level security;
revoke all on public.snoop_suppliers,public.snoop_expenses,public.snoop_purchases from public,anon,authenticated;
grant select,insert on public.snoop_suppliers,public.snoop_expenses,public.snoop_purchases to authenticated;
drop policy if exists snoop_supplier_admin_select on public.snoop_suppliers;
create policy snoop_supplier_admin_select on public.snoop_suppliers for select to authenticated using (
 club_id=(select public.current_club_id()) and (select public.is_current_user_club_admin(club_id))
);
drop policy if exists snoop_supplier_admin_insert on public.snoop_suppliers;
create policy snoop_supplier_admin_insert on public.snoop_suppliers for insert to authenticated with check (
 club_id=(select public.current_club_id()) and created_by=(select auth.uid()) and (select public.is_current_user_club_admin(club_id))
);
drop policy if exists snoop_expense_admin_select on public.snoop_expenses;
create policy snoop_expense_admin_select on public.snoop_expenses for select to authenticated using (
 club_id=(select public.current_club_id()) and (select public.is_current_user_club_admin(club_id))
);
drop policy if exists snoop_expense_admin_insert on public.snoop_expenses;
create policy snoop_expense_admin_insert on public.snoop_expenses for insert to authenticated with check (
 club_id=(select public.current_club_id()) and created_by=(select auth.uid()) and (select public.is_current_user_club_admin(club_id))
);
drop policy if exists snoop_purchase_admin_select on public.snoop_purchases;
create policy snoop_purchase_admin_select on public.snoop_purchases for select to authenticated using (
 club_id=(select public.current_club_id()) and (select public.is_current_user_club_admin(club_id))
);
drop policy if exists snoop_purchase_admin_insert on public.snoop_purchases;
create policy snoop_purchase_admin_insert on public.snoop_purchases for insert to authenticated with check (
 club_id=(select public.current_club_id()) and created_by=(select auth.uid()) and (select public.is_current_user_club_admin(club_id))
);
-- Only explicitly authorised, audited annulment may change an expense; never delete rows.
create or replace function public.snoop_cancel_expense(p_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $
declare v_club uuid; v_record public.snoop_expenses;
begin
 v_club:=public.current_club_id();
 if auth.uid() is null or v_club is null or not public.is_current_user_club_admin(v_club)
 then raise exception 'Forbidden' using errcode='42501'; end if;
 if length(btrim(coalesce(p_reason,'')))<5 or length(p_reason)>500
 then raise exception 'Motivo de 5 a 500 caracteres requerido' using errcode='22023'; end if;
 select * into v_record from public.snoop_expenses where club_id=v_club and id=p_id for update;
 if not found then raise exception 'Registro no disponible' using errcode='42501'; end if;
 if v_record.cancelled_at is not null then
  if v_record.cancelled_by=auth.uid() and v_record.cancel_reason=btrim(p_reason) then return p_id; end if;
  raise exception 'Registro anulado previamente' using errcode='22023';
 end if;
 update public.snoop_expenses set cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=btrim(p_reason)
 where id=p_id and club_id=v_club;
 return p_id;
end $;
revoke all on function public.snoop_cancel_expense(uuid,text) from public,anon,authenticated;
grant execute on function public.snoop_cancel_expense(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;