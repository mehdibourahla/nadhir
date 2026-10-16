-- DGPC spellings the gazetteer misses, each read from a quarantined bulletin
insert into public.admin_unit_aliases (admin_unit_id, alias_ar, source)
select u.id, a.alias_ar, 'dgpc'
from (values
  ('0814', 'الواطة'),
  ('0811', 'إيغلي'),
  ('1102', 'أبالسة'),
  ('2135', 'الولجة')
) as a(code, alias_ar)
join public.admin_units u on u.code = a.code and u.level = 'commune'
on conflict do nothing;

update public.source_contracts set parser_version='dgpc-extract-v6' where key='dgpc_telegram';
