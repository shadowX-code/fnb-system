-- Include actual staff-authored Outlet questions and common money/time phrasings.
create or replace function marketing_private.inbox_faq_use_issue(f public.marketing_inbox_faqs) returns text language plpgsql stable set search_path=public as $$
declare t text:=lower(normalize(f.question||' '||f.answer||' '||array_to_string(f.alternative_questions,' '),NFKC)); addresses text[];
begin
 if not f.is_active then return 'Inactive FAQ';end if;
 if cardinality(marketing_private.inbox_risk(t))>0 then return 'Sensitive request: staff review required.';end if;
 if f.category='location' or t ~ '(address|location|located|outlet|where|地址|地点|位置|哪里|哪裡|分店|alamat|lokasi|di mana)' then
  select array_agg(distinct btrim(o.address) order by btrim(o.address)) into addresses from public.brand_outlets bo join public.outlets o on o.id=bo.outlet_id join public.brands b on b.id=bo.brand_id and b.organization_id=bo.organization_id where bo.brand_id=f.brand_id and o.is_active and nullif(btrim(o.address),'') is not null;
  -- Accept only an exact complete canonical address list, not a guessed Outlet or a free-text claim.
  if addresses is null then return 'Location cannot be checked: no canonical Outlet address is available. Staff must confirm the Outlet.';end if;
  if marketing_private.inbox_faq_normalize(f.answer)<>marketing_private.inbox_faq_normalize(array_to_string(addresses,'; ')) then return 'Location answer differs from the complete Restaurant Outlet address list. Check the canonical addresses; no Outlet is inferred.';end if;
 end if;
 if f.category in ('operating_hours','menu_drinks','promotions') or t ~ '(\m(hours?|open|opens|opening|close|closes|closing|menu|price|prices|promotion|promotions|discount|diskaun|harga|pukul|buka|tutup)\M|营业|菜单|价格|优惠|促销|营业时间|多少钱|幾點|几点|\m(rm|myr)[[:space:]]*[0-9]|[0-9]+[[:space:]]*(am|pm)|how much|berapa)' then
  return 'Operational information is not available from a reliable current source. Staff must confirm it before replying.';
 end if;
 return null;
end;$$;
