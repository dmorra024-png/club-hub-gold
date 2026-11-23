-- Report of product-level entries, dispensations and planned contribution as of selected day.
-- Reads purchase/sale reference unit prices *currently configured*. Actual revenue comes
-- from persisted completed order_item line totals, not predicted current prices.
-- Cancelled orders are excluded according to CURRENT status, not historical as-of status.
create or replace function public.snoop_product_economics_report(p_day date)
returns jsonb language plpgsql security definer set search_path='' as $economics$
declare c uuid; end_at timestamptz; selected_day date; output jsonb;
begin
 c:=public.current_club_id();
 selected_day:=(now() at time zone 'Europe/Madrid')::date;
 if auth.uid() is null or c is null or not public.can_operate_club(c,'view_reports'::public.app_permission)
 then raise exception 'Informe no autorizado' using errcode='42501';end if;
 if p_day is null or p_day<date '2020-01-01' or p_day>selected_day
 then raise exception 'Fecha no válida' using errcode='22023';end if;
 end_at:=least(((p_day+1)::timestamp at time zone 'Europe/Madrid'),now());
 with all_movements as (
   select m.product_id,
     coalesce(sum(m.delta) filter(where m.created_at>=end_at),0) as after_cutoff,
     coalesce(sum(m.delta) filter(where m.created_at<end_at and m.delta>0
       and m.reason in ('initial_stock','administrative_adjustment')),0) as loaded_qty,
     count(*) filter(where m.created_at<end_at and m.delta>0
       and m.reason in ('initial_stock','administrative_adjustment')) as recharge_count
   from public.stock_movements m where m.club_id=c group by m.product_id
 ),
 sales as (
   select oi.product_id,coalesce(sum(oi.quantity),0) as dispensed_qty,
     coalesce(sum(oi.line_total_cents),0)::numeric/100 as actual_revenue
   from public.order_items oi
   join public.orders o on o.id=oi.order_id and o.club_id=oi.club_id
   where oi.club_id=c and o.status='completed'
     and o.created_at<end_at
   group by oi.product_id
 ),
 lines as (
   select p.id,p.name,p.category_id,cat.unit_type,p.created_at,
     p.buy_price as buy_price,p.sell_price as sell_price,
     greatest(p.stock-coalesce(m.after_cutoff,0),0) as remaining_qty,
     (p.stock-coalesce(m.after_cutoff,0))<0 as invalid_stock,
     coalesce(m.loaded_qty,0) as loaded_qty,
     coalesce(m.recharge_count,0) as recharge_count,
     coalesce(s.dispensed_qty,0) as dispensed_qty,
     coalesce(s.actual_revenue,0) as actual_revenue,
     (p.buy_price is null or p.buy_price<=0) as missing_buy,
     (p.sell_price is null or p.sell_price<=0) as missing_sell
   from public.products p
   left join public.product_categories cat on cat.id=p.category_id and cat.club_id=c
   left join all_movements m on m.product_id=p.id
   left join sales s on s.product_id=p.id
   where p.club_id=c and p.created_at<end_at
 ), valued as (
   select l.*,
     l.loaded_qty*greatest(coalesce(l.buy_price,0),0) as recorded_entry_cost,
     l.loaded_qty*greatest(coalesce(l.sell_price,0),0) as projected_loaded_revenue,
     l.remaining_qty*greatest(coalesce(l.sell_price,0),0) as projected_remaining_revenue,
     l.remaining_qty*greatest(coalesce(l.buy_price,0),0) as remaining_cost,
     l.actual_revenue-l.dispensed_qty*greatest(coalesce(l.buy_price,0),0) as actual_gross_margin,
     (l.loaded_qty*greatest(coalesce(l.sell_price,0),0)
        -l.loaded_qty*greatest(coalesce(l.buy_price,0),0)) as projected_loaded_gross_margin
   from lines l
 )
 select jsonb_build_object(
   'day',p_day,'as_of',end_at,'basis','current_buy_sell_prices',
   'totals',(select jsonb_build_object(
     'loaded_cost',round(coalesce(sum(recorded_entry_cost),0),2),
     'projected_loaded_revenue',round(coalesce(sum(projected_loaded_revenue),0),2),
     'projected_loaded_gross_margin',round(coalesce(sum(projected_loaded_gross_margin),0),2),
     'actual_revenue',round(coalesce(sum(actual_revenue),0),2),
     'actual_gross_margin',round(coalesce(sum(actual_gross_margin),0),2),
     'remaining_revenue',round(coalesce(sum(projected_remaining_revenue),0),2),
     'remaining_cost',round(coalesce(sum(remaining_cost),0),2),
     'missing_buy',count(*) filter(where missing_buy and (remaining_qty>0 or loaded_qty>0)),
     'missing_sell',count(*) filter(where missing_sell and (remaining_qty>0 or loaded_qty>0)),
     'invalid_stock',count(*) filter(where invalid_stock)
   ) from valued),
   'products',(
     select coalesce(jsonb_agg(
       jsonb_build_object(
         'id',v.id,'name',v.name,'unit',coalesce(v.unit_type::text,'unit'),
         'buy_price',v.buy_price,'sell_price',v.sell_price,
         'loaded_qty',v.loaded_qty,'recharge_count',v.recharge_count,
         'loaded_cost',round(v.recorded_entry_cost,2),
         'projected_loaded_revenue',round(v.projected_loaded_revenue,2),
         'projected_gross_margin',round(v.projected_loaded_gross_margin,2),
         'dispensed_qty',v.dispensed_qty,'actual_revenue',round(v.actual_revenue,2),
         'actual_gross_margin',round(v.actual_gross_margin,2),
         'remaining_qty',v.remaining_qty,'remaining_revenue',round(v.projected_remaining_revenue,2),
         'remaining_cost',round(v.remaining_cost,2),
         'missing_buy',v.missing_buy,'missing_sell',v.missing_sell,'invalid_stock',v.invalid_stock,
         'recharges',(select coalesce(jsonb_agg(jsonb_build_object(
           'date',e.created_at,'quantity',e.delta,'reason',e.reason
         ) order by e.created_at desc),'[]'::jsonb)
          from (select m.created_at,m.delta,m.reason
                from public.stock_movements m where m.club_id=c and m.product_id=v.id
                  and m.created_at<end_at and m.delta>0
                  and m.reason in ('initial_stock','administrative_adjustment')
                order by m.created_at desc limit 50) e)
       ) order by v.name
     ),'[]'::jsonb)
     from valued v
   )
 ) into output;
 return output;
end $economics$;
revoke all on function public.snoop_product_economics_report(date) from public,anon;
grant execute on function public.snoop_product_economics_report(date) to authenticated;
notify pgrst,'reload schema';
