begin;
set local search_path=public,extensions;
select no_plan();
select has_table('public','civil_decisions','agent decisions retained');
select has_table('public','civil_investigations','durable investigation queue');
set local role anon;
select throws_ok($$select * from civil_decisions$$,'42501',null,'private decision evidence');
select throws_ok($$select claim_civil_investigations(gen_random_uuid(),1,1)$$,'42501',null,'anonymous cannot claim');
set local role authenticated;
select is((select count(*) from civil_decisions),0::bigint,'ordinary users cannot read decisions');
select throws_ok($$select claim_civil_investigations(gen_random_uuid(),1,1)$$,'42501',null,'operators cannot run autonomous worker');
set local role service_role;
select throws_ok($$select claim_civil_investigations(gen_random_uuid(),1,1)$$,'55000','ita_source_lease_lost','worker requires active source lease');
reset role;
insert into admin_units(id,level,code,name_ar,name_fr,name_en,lat,lon) values
 ('17000000-0000-4000-8000-000000000010','wilaya','agent-test','تيبازة','Tipaza test','Tipaza test',36,3);
insert into ita_reports(id,source_post_id,source_page,source_url,published_at,content_hash,body,raw,extraction)
 values('17000000-0000-4000-8000-000000000020','agent-post','traficalg','https://www.facebook.com/traficalg/posts/agent-post',now()-interval '1 hour',repeat('e',64),'Accident Tipaza','{}',
 '{"disposition":"incident_report","incidents":[{"kind":"collision","summary_fr":"Accident","evidence":"Accident"}],"review_reasons":[]}');
select public.enqueue_due_source_jobs(now(),'database');
select set_config('agent.job',id::text,true),set_config('agent.attempt',attempt_count::text,true)
 from public.claim_source_job('civil-agent-sql-test','cloudflare','ita_website');
set local role service_role;
select set_config('agent.work',id::text,true) from claim_civil_investigations(current_setting('agent.job')::uuid,current_setting('agent.attempt')::integer,2);
select is((select attempts from civil_investigations where id=current_setting('agent.work')::uuid),1,'claim increments attempt');
select is((select count(*) from claim_civil_investigations(current_setting('agent.job')::uuid,current_setting('agent.attempt')::integer,2)),0::bigint,'cannot claim twice while processing');
select set_config('agent.result',jsonb_build_object('model','test-model','version','civil-agent-v1',
 'decision',jsonb_build_object('outcome','publish','reason','Explicit area','area_id','17000000-0000-4000-8000-000000000010','hazard','road','summary','Accident signalé à Tipaza','location_evidence','Tipaza','expires_at',now()+interval '2 hours','duplicate_id',null),
 'trace',jsonb_build_array(jsonb_build_object('action','search_areas','query','Tipaza','parent_id',null,'results',jsonb_build_array(jsonb_build_object('id','17000000-0000-4000-8000-000000000010')))))::text,true);
select throws_ok($$select finish_civil_investigation(current_setting('agent.job')::uuid,current_setting('agent.attempt')::integer,current_setting('agent.work')::uuid,2,current_setting('agent.result')::jsonb,null)$$,'55000','civil_investigation_claim_lost','old attempt cannot finish');
select throws_ok($$select finish_civil_investigation(current_setting('agent.job')::uuid,current_setting('agent.attempt')::integer,current_setting('agent.work')::uuid,1,jsonb_set(current_setting('agent.result')::jsonb,'{trace}','[]'),null)$$,'22023','civil_area_not_in_evidence','invented location rejected');
select lives_ok($$select finish_civil_investigation(current_setting('agent.job')::uuid,current_setting('agent.attempt')::integer,current_setting('agent.work')::uuid,1,current_setting('agent.result')::jsonb,null)$$,'agent publishes atomically');
select is((select count(*) from civil_decisions),1::bigint,'one immutable decision');
select is((select count(*) from civil_publications where ita_report_id='17000000-0000-4000-8000-000000000020'),1::bigint,'one publication');
select throws_ok($$select finish_civil_investigation(current_setting('agent.job')::uuid,current_setting('agent.attempt')::integer,current_setting('agent.work')::uuid,1,current_setting('agent.result')::jsonb,null)$$,'55000','civil_investigation_claim_lost','replayed completion rejected');
select throws_ok($$update civil_decisions set model='rewrite'$$,'42501',null,'service cannot rewrite ledger');
reset role;
select is((select actor_kind from civil_publication_revisions where publication_id=(select publication_id from civil_decisions)),'agent','audit distinguishes agent from human');
select is((select actor_id from civil_publication_revisions where publication_id=(select publication_id from civil_decisions)),null::uuid,'no forged human actor');
select throws_ok($$update civil_decisions set model='rewrite'$$,'55000','civil_decision_is_immutable','owner cannot rewrite ledger');
set local role anon;
select is((select count(*) from civil_publications where ita_report_id='17000000-0000-4000-8000-000000000020'),1::bigint,'published information public');
select throws_ok($$select * from civil_decisions$$,'42501',null,'investigation remains private after publication');
reset role;
insert into ita_reports(id,source_post_id,source_page,source_url,published_at,content_hash,body,raw,extraction)
 values('17000000-0000-4000-8000-000000000021','agent-retry','traficalg','https://www.facebook.com/traficalg/posts/agent-retry',now()-interval '1 hour',repeat('f',64),'Accident Tipaza','{}',
 '{"disposition":"incident_report","incidents":[{"kind":"collision","summary_fr":"Accident","evidence":"Accident"}],"review_reasons":[]}');
set local role service_role;
select set_config('agent.work',id::text,true) from claim_civil_investigations(current_setting('agent.job')::uuid,current_setting('agent.attempt')::integer,1);
select lives_ok($$select finish_civil_investigation(current_setting('agent.job')::uuid,current_setting('agent.attempt')::integer,current_setting('agent.work')::uuid,1,null,'provider unavailable')$$,'failure retained');
select is((select failures from civil_investigations where id=current_setting('agent.work')::uuid),1,'failure counted separately');
reset role;
update civil_investigations set next_attempt_at=now()-interval '1 second',attempts=6,failures=5 where id=current_setting('agent.work')::uuid;
set local role service_role;
select is((select attempts from claim_civil_investigations(current_setting('agent.job')::uuid,current_setting('agent.attempt')::integer,1)),7,'exhausted provider failures recover autonomously');
select lives_ok($$select finish_civil_investigation(current_setting('agent.job')::uuid,current_setting('agent.attempt')::integer,current_setting('agent.work')::uuid,7,jsonb_set(current_setting('agent.result')::jsonb,'{decision,outcome}','"hold"'),null)$$,'semantic hold after successful investigation');
select is((select failures from civil_investigations where id=current_setting('agent.work')::uuid),0,'successful hold clears failure streak');
select is((select state from civil_investigations where id=current_setting('agent.work')::uuid),'hold','hold not mistaken for exhausted failure');
reset role;
update civil_investigations set next_attempt_at=now()-interval '1 second' where id=current_setting('agent.work')::uuid;
set local role service_role;
select is((select attempts from claim_civil_investigations(current_setting('agent.job')::uuid,current_setting('agent.attempt')::integer,1)),8,'hold revisited after more than five investigations');
reset role;
insert into ita_reports(id,source_post_id,source_page,source_url,published_at,fetched_at,content_hash,body,raw,extraction)
 values('17000000-0000-4000-8000-000000000022','agent-retry','traficalg','https://www.facebook.com/traficalg/posts/agent-retry',now()-interval '1 hour',clock_timestamp(),repeat('b',64),'Correction Alger','{}',
 '{"disposition":"incident_report","incidents":[{"kind":"collision","summary_fr":"Correction","evidence":"Correction"}],"review_reasons":[]}');
set local role service_role;
select lives_ok($$select finish_civil_investigation(current_setting('agent.job')::uuid,current_setting('agent.attempt')::integer,current_setting('agent.work')::uuid,8,current_setting('agent.result')::jsonb,null)$$,'source correction fences older in-flight work');
select is((select state from civil_investigations where id=current_setting('agent.work')::uuid),'superseded','old source marked superseded');
select is((select count(*) from civil_publications where ita_report_id='17000000-0000-4000-8000-000000000021'),0::bigint,'outdated source never published');
reset role;
insert into auth.users(id,email) values('17000000-0000-4000-8000-000000000001','agent-operator@example.invalid');
insert into user_roles(user_id,role) values('17000000-0000-4000-8000-000000000001','operator');
select set_config('agent.publication',id::text,true) from civil_publications where ita_report_id='17000000-0000-4000-8000-000000000020';
set local role authenticated;
select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000001',true);
select lives_ok($$select revise_civil_publication(current_setting('agent.publication')::uuid,1,'withdraw','{}','Operator withdrawal')$$,'operator withdraws agent publication');
reset role;
insert into ita_reports(id,source_post_id,source_page,source_url,published_at,fetched_at,content_hash,body,raw,extraction)
 values('17000000-0000-4000-8000-000000000023','agent-post','traficalg','https://www.facebook.com/traficalg/posts/agent-post',now()-interval '1 hour',clock_timestamp(),repeat('c',64),'Accident Tipaza','{}',
 '{"disposition":"incident_report","incidents":[{"kind":"collision","summary_fr":"Accident","evidence":"Accident"}],"review_reasons":[]}');
set local role service_role;
select set_config('agent.correction',id::text,true) from claim_civil_investigations(current_setting('agent.job')::uuid,current_setting('agent.attempt')::integer,2) where report_id='17000000-0000-4000-8000-000000000023';
select throws_ok($$select finish_civil_investigation(current_setting('agent.job')::uuid,current_setting('agent.attempt')::integer,current_setting('agent.correction')::uuid,1,current_setting('agent.result')::jsonb,null)$$,'55000','civil_source_revision_requires_reconciliation','corrected post cannot bypass operator withdrawal');
set local role authenticated;
select lives_ok($$select publish_ita_publication('17000000-0000-4000-8000-000000000023',0,'road','Correction','17000000-0000-4000-8000-000000000010',now()+interval '1 hour','Reviewed corrected source')$$,'operator can explicitly publish newest corrected source');
select is((select state from civil_publications where id=current_setting('agent.publication')::uuid),'withdrawn','operator withdrawal preserved');
reset role;
insert into ita_reports(id,source_post_id,source_page,source_url,published_at,fetched_at,content_hash,body,raw,extraction)
 values('17000000-0000-4000-8000-000000000024','agent-post','traficalg','https://www.facebook.com/traficalg/posts/agent-post',now()-interval '1 hour',clock_timestamp(),repeat('d',64),'Accident Tipaza','{}',
 '{"disposition":"incident_report","incidents":[{"kind":"collision","summary_fr":"Accident","evidence":"Accident"}],"review_reasons":[]}');
set local role authenticated;
select lives_ok($$select publish_ita_publication('17000000-0000-4000-8000-000000000024',0,'road','Nouvelle correction','17000000-0000-4000-8000-000000000010',now()+interval '1 hour','Reviewed newer correction')$$,'operator replaces active earlier source revision');
select is((select state from civil_publications where ita_report_id='17000000-0000-4000-8000-000000000023'),'withdrawn','prior active revision withdrawn atomically');
select is((select count(*) from civil_publications p join ita_reports r on r.id=p.ita_report_id where r.source_post_id='agent-post' and p.state='published'),1::bigint,'one active publication after human correction');
select is((select actor_kind from civil_publication_revisions where publication_id=(select id from civil_publications where ita_report_id='17000000-0000-4000-8000-000000000023') and revision=2),'human','manual source correction preserves human audit');
reset role;
select * from finish();
rollback;
