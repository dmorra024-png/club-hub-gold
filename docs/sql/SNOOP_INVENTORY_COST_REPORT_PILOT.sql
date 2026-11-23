-- Read-only historical purchase-cost stock valuation for SNOOP Informes.
-- Reconstruct quantities at the start of the selected Europe/Madrid calendar day
-- from the canonical current stock and the append-only stock movement ledger.
-- Price basis is the *current* buy_price, never advertised as original historical cost.
create or replace function public.snoop_inventory_cost_report(p_day date)
returns jsonb
language plpgsql
security definer
set search_path=''
as $report$
declare
 v_club uuid;
 v_start timestamptz;
 v_end timestamptz;
 v_today date;
 v_result jsonb;
begin
 v_club:=public.current_club_id();
 v_today:=(now() at time zone 'Europe/Madrid')::date;
 if auth.uid() is null or v_club is null or not public.can_operate_club(v_club,'view_reports'::public.app_permission)
 then raise exception 'Informe no autorizado' using errcode='42501';end if;
 if p_day is null or p_day>v_today or p_day<date '2020-01-01'
 then raise exception 'Fecha no válida' using errcode='22023';end if;
 v_start:=p_day::timestamp at time zone 'Europe/Madrid';
 v_end:=least((p_day+1)::timestamp at time zone 'Europe/Madrid',now());
 with movements as (
  select m.product_id,
   coalesce(sum(m.delta) filter(where m.created_at>=v_start),0)::numeric as after_start,
   coalesce(sum(m.delta) filter(where m.created_at>=v_start and m.created_at<v_end and m.delta>0),0)::numeric as incoming,
   coalesce(-sum(m.delta) filter(where m.created_at>=v_start and m.created_at<v_end and m.delta<0),0)::numeric as outgoing
  from public.stock_movements m
  where m.club_id=v_club and m.created_at>=v_start
  group by m.product_id
 ),
 lines as (
  select p.id,p.name,p.stock::numeric as current_qty,
   p.buy_price::numeric as unit_cost,
   (p.stock-coalesce(m.after_start,0))::numeric as opening_qty,
   coalesce(m.incoming,0)::numeric as incoming_qty,
   coalesce(m.outgoing,0)::numeric as outgoing_qty,
   (p.stock-coalesce(m.after_start,0)+coalesce(m.incoming,0)-coalesce(m.outgoing,0))::numeric as closing_qty,
   (p.buy_price is null or p.buy_price<=0) and (
    abs(p.stock-coalesce(m.after_start,0))>0 or
    coalesce(m.incoming,0)>0 or coalesce(m.outgoing,0)>0
   ) as unpriced
  from public.products p left join movements m on m.product_id=p.id
  where p.club_id=v_club
 ),
 totals as (
  select count(*) filter(where unpriced) as missing_cost,
    count(*) filter(where opening_qty<0 or closing_qty<0) as invalid_quantities,
    coalesce(sum(greatest(opening_qty,0)*greatest(unit_cost,0)),0) as opening_value,
    coalesce(sum(incoming_qty*greatest(unit_cost,0)),0) as incoming_value,
    coalesce(sum(outgoing_qty*greatest(unit_cost,0)),0) as outgoing_value,
    coalesce(sum(greatest(closing_qty,0)*greatest(unit_cost,0)),0) as closing_value
   from lines
 )
 select jsonb_build_object(
  'day',p_day,
  'start_at',v_start,
  'end_at',v_end,
  'cost_basis','current_purchase_price',
  'opening_eur',round(t.opening_value,2),
  'incoming_eur',round(t.incoming_value,2),
  'outgoing_eur',round(t.outgoing_value,2),
  'closing_eur',round(t.closing_value,2),
  'missing_cost',t.missing_cost,
  'invalid_quantities',t.invalid_quantities,
  'lines',(select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'name',l.name,'opening_qty',l.opening_qty,'incoming_qty',l.incoming_qty,
    'outgoing_qty',l.outgoing_qty,'closing_qty',l.closing_qty,'cost',l.unit_cost,'unpriced',l.unpriced
   ) order by l.name),'[]'::jsonb)
   from lines l where l.opening_qty<>0 or l.incoming_qty<>0 or l.outgoing_qty<>0 or l.closing_qty<>0)
 ) into v_result from totals t;
 return v_result;
end
$report$;
revoke all on function public.snoop_inventory_cost_report(date) from public,anon;
grant execute on function public.snoop_inventory_cost_report(date) to authenticated;
notify pgrst,'reload schema';
