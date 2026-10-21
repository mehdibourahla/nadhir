begin;
set local search_path=public,extensions;
select no_plan();
set local role anon;
select throws_ok($$select * from search_civil_official_evidence()$$,'42501',null,'anonymous cannot run investigation tools');
set local role authenticated;
select throws_ok($$select * from search_civil_official_evidence()$$,'42501',null,'signed-in users cannot run investigation tools');
reset role;
insert into admin_units(id,level,code,name_ar,name_fr,name_en,lat,lon) values
 ('18000000-0000-4000-8000-000000000010','wilaya','reconcile-test','تيبازة','Tipaza','Tipaza',36,3);
insert into source_documents(id,text_source_id,external_id,url,published_at,content_hash,body)
 select '18000000-0000-4000-8000-000000000011',id,'reconcile-test','https://t.me/DGPCDZ/1',now()-interval '1 hour','reconcile-test','حريق في تيبازة'
 from text_sources where key='dgpc_telegram';
insert into incident_mentions(id,document_id,text_source_id,wilaya_id,kind,status,as_of,precision,evidence,extractor)
 select '18000000-0000-4000-8000-000000000012','18000000-0000-4000-8000-000000000011',id,
 '18000000-0000-4000-8000-000000000010','vegetation','ongoing',now()-interval '1 hour','wilaya','حريق في تيبازة','llm'
 from text_sources where key='dgpc_telegram';
insert into official_incidents(id,wilaya_id,kind,status,precision,authority_tier,first_reported_at,last_reported_at,as_of,latest_mention_id,evidence)
 values('18000000-0000-4000-8000-000000000013','18000000-0000-4000-8000-000000000010','vegetation','ongoing','wilaya','national',now()-interval '1 hour',now()-interval '1 hour',now()-interval '1 hour','18000000-0000-4000-8000-000000000012','حريق في تيبازة');
update incident_mentions set incident_id='18000000-0000-4000-8000-000000000013' where id='18000000-0000-4000-8000-000000000012';
insert into ita_reports(id,source_post_id,source_page,source_url,published_at,content_hash,body,raw,extraction)
 values('18000000-0000-4000-8000-000000000020','reconcile-test','traficalg','https://www.facebook.com/traficalg/posts/reconcile-test',now()-interval '1 hour',repeat('e',64),'حريق في تيبازة','{}',
 '{"disposition":"incident_report","incidents":[{"kind":"fire","summary_fr":"Feu signalé","evidence":"حريق"}],"review_reasons":[]}');
select enqueue_due_source_jobs(now(),'database');
select set_config('reconcile.job',id::text,true),set_config('reconcile.attempt',attempt_count::text,true)
 from claim_source_job('reconciliation-sql-test','cloudflare','ita_website');
set local role service_role;
select is((select count(*) from search_civil_official_evidence('تيبازة','18000000-0000-4000-8000-000000000010')),1::bigint,'official tool returns source evidence');
select is((select count(*) from search_civil_official_evidence('%',null)),0::bigint,'search treats wildcard as literal');
select is((select count(*) from search_civil_official_evidence(null,'18000000-0000-4000-8000-000000000099')),0::bigint,'area search is bounded');
select set_config('reconcile.work',id::text,true) from claim_civil_investigations(current_setting('reconcile.job')::uuid,current_setting('reconcile.attempt')::integer,1);
select set_config('reconcile.result',jsonb_build_object('model','test-model','version','civil-agent-v2',
 'decision',jsonb_build_object('outcome','discard','reason','Même événement déjà couvert','area_id',null,'hazard','fire','summary','Feu signalé','location_evidence',null,'expires_at',null,'duplicate_id',null,
 'official_match',jsonb_build_object('incident_id','18000000-0000-4000-8000-000000000013','mention_id','18000000-0000-4000-8000-000000000012','relationship','duplicate','reason','Même événement','source_quote','حريق في تيبازة','official_quote','حريق في تيبازة')),
 'trace',jsonb_build_array(jsonb_build_object('action','official_reports','query',null,'parent_id',null,'results',(select jsonb_agg(to_jsonb(e)) from search_civil_official_evidence() e))))::text,true);
select throws_ok($$select finish_civil_investigation(current_setting('reconcile.job')::uuid,current_setting('reconcile.attempt')::integer,current_setting('reconcile.work')::uuid,1,jsonb_set(current_setting('reconcile.result')::jsonb,'{trace}','[]'),null)$$,'22023','civil_official_not_observed','cannot invent a cross-source link');
select throws_ok($$select finish_civil_investigation(current_setting('reconcile.job')::uuid,current_setting('reconcile.attempt')::integer,current_setting('reconcile.work')::uuid,1,jsonb_set(current_setting('reconcile.result')::jsonb,'{decision,official_match,official_quote}','"invented"'),null)$$,'22023','civil_official_quote_invalid','official quote must exist');
select throws_ok($$select finish_civil_investigation(current_setting('reconcile.job')::uuid,current_setting('reconcile.attempt')::integer,current_setting('reconcile.work')::uuid,1,jsonb_set(current_setting('reconcile.result')::jsonb,'{decision,official_match,source_quote}','"invented"'),null)$$,'22023','civil_official_quote_invalid','ITA quote must exist');
select throws_ok($$select finish_civil_investigation(current_setting('reconcile.job')::uuid,current_setting('reconcile.attempt')::integer,current_setting('reconcile.work')::uuid,1,jsonb_set(current_setting('reconcile.result')::jsonb,'{decision,outcome}','"publish"'),null)$$,'22023','civil_official_match_invalid','duplicate cannot also publish');
reset role;
update official_incidents set place_text='Corrected location' where id='18000000-0000-4000-8000-000000000013';
set local role service_role;
select throws_ok($$select finish_civil_investigation(current_setting('reconcile.job')::uuid,current_setting('reconcile.attempt')::integer,current_setting('reconcile.work')::uuid,1,current_setting('reconcile.result')::jsonb,null)$$,'55000','civil_official_evidence_changed','corrected place rejects stale comparison');
reset role;
update official_incidents set place_text=null where id='18000000-0000-4000-8000-000000000013';
update official_incidents set status='extinguished' where id='18000000-0000-4000-8000-000000000013';
set local role service_role;
select throws_ok($$select finish_civil_investigation(current_setting('reconcile.job')::uuid,current_setting('reconcile.attempt')::integer,current_setting('reconcile.work')::uuid,1,current_setting('reconcile.result')::jsonb,null)$$,'55000','civil_official_evidence_changed','changed official state rejects stale comparison');
select is((select count(*) from civil_decisions),0::bigint,'rejected decision leaves no ledger entry');
select is((select state from civil_investigations where id=current_setting('reconcile.work')::uuid),'processing','rejected transaction keeps claim for failure recording');
reset role;
update official_incidents set status='ongoing',unlisted_at=now() where id='18000000-0000-4000-8000-000000000013';
set local role service_role;
select is((select count(*) from search_civil_official_evidence()),0::bigint,'unlisted incidents excluded');
select throws_ok($$select finish_civil_investigation(current_setting('reconcile.job')::uuid,current_setting('reconcile.attempt')::integer,current_setting('reconcile.work')::uuid,1,current_setting('reconcile.result')::jsonb,null)$$,'55000','civil_official_evidence_changed','unlisting prevents stale suppression');
reset role;
update official_incidents set unlisted_at=null where id='18000000-0000-4000-8000-000000000013';
set local role service_role;
select lives_ok($$select finish_civil_investigation(current_setting('reconcile.job')::uuid,current_setting('reconcile.attempt')::integer,current_setting('reconcile.work')::uuid,1,current_setting('reconcile.result')::jsonb,null)$$,'grounded duplicate is retained in ledger');
select is((select state from civil_investigations where id=current_setting('reconcile.work')::uuid),'discard','duplicate decision applied');
select is((select decision->'official_match'->>'mention_id' from civil_decisions),'18000000-0000-4000-8000-000000000012','exact official revision retained');
select is((select count(*) from civil_publications),0::bigint,'no redundant public item');
select is((select status from official_incidents where id='18000000-0000-4000-8000-000000000013'),'ongoing','comparison never changes official status');
reset role;
insert into ita_reports(id,source_post_id,source_page,source_url,published_at,content_hash,body,raw,extraction)
 values('18000000-0000-4000-8000-000000000021','reconcile-context','traficalg','https://www.facebook.com/traficalg/posts/reconcile-context',now()-interval '1 hour',repeat('f',64),'حريق في تيبازة','{}',
 '{"disposition":"incident_report","incidents":[{"kind":"fire","summary_fr":"Feu signalé","evidence":"حريق"}],"review_reasons":[]}');
set local role service_role;
select set_config('reconcile.work',id::text,true) from claim_civil_investigations(current_setting('reconcile.job')::uuid,current_setting('reconcile.attempt')::integer,1);
select set_config('reconcile.result',(current_setting('reconcile.result')::jsonb || jsonb_build_object(
 'decision',(current_setting('reconcile.result')::jsonb->'decision') || jsonb_build_object('outcome','publish','area_id','18000000-0000-4000-8000-000000000010','location_evidence','تيبازة','expires_at',now()+interval '2 hours',
 'official_match',(current_setting('reconcile.result')::jsonb->'decision'->'official_match') || '{"relationship":"context","reason":"Informations complémentaires"}'::jsonb),
 'trace',(current_setting('reconcile.result')::jsonb->'trace') || jsonb_build_array(jsonb_build_object('action','search_areas','results',jsonb_build_array(jsonb_build_object('id','18000000-0000-4000-8000-000000000010'))))))::text,true);
select lives_ok($$select finish_civil_investigation(current_setting('reconcile.job')::uuid,current_setting('reconcile.attempt')::integer,current_setting('reconcile.work')::uuid,1,current_setting('reconcile.result')::jsonb,null)$$,'official context permits useful media publication');
select is((select source_name from civil_publications where ita_report_id='18000000-0000-4000-8000-000000000021'),'Info Trafic Algérie','official relationship does not transfer authority');
select is((select count(*) from broadcasts),0::bigint,'comparison does not send alerts');
select * from finish();
rollback;
