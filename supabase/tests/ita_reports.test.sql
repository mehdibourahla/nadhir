begin;
set local search_path = public, extensions;
select plan(43);
select has_table('public','ita_reports','ITA source revisions exist');
select is((select cadence_minutes from source_contracts where key='ita_website'),5,'five-minute schedule');
insert into auth.users(id,email) values
 ('15000000-0000-4000-8000-000000000001','ita-admin@example.invalid'),
 ('15000000-0000-4000-8000-000000000002','ita-operator@example.invalid');
insert into user_roles(user_id,role) values
 ('15000000-0000-4000-8000-000000000001','admin'),
 ('15000000-0000-4000-8000-000000000002','operator');
insert into ita_reports(source_post_id,source_page,source_url,published_at,content_hash,body,raw)
 values('post','traficalg','https://www.facebook.com/traficalg/posts/post',now(),repeat('a',64),'source text','{}');
set local role anon;
select throws_ok($$select * from ita_reports$$,'42501',null,'anonymous cannot read');
select throws_ok($$select * from ita_feed_state$$,'42501',null,'anonymous cannot read checkpoint');
set local role authenticated;
select set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000003',true);
select is((select count(*) from ita_reports),0::bigint,'ordinary users cannot read');
select set_config('request.jwt.claims','{"user_metadata":{"role":"admin"}}',true);
select is((select count(*) from ita_reports),0::bigint,'forged metadata grants no access');
select set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000002',true);
select is((select count(*) from ita_reports),1::bigint,'operator can read');
select set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000001',true);
select is((select count(*) from ita_reports),1::bigint,'admin can read');
select throws_ok($$update ita_reports set extraction='{}'$$,'42501',null,'admin cannot write extraction');
select throws_ok($$delete from ita_reports$$,'42501',null,'admin cannot delete');
select throws_ok($$insert into ita_reports default values$$,'42501',null,'admin cannot insert');
select throws_ok($$select save_ita_feed(gen_random_uuid(),1,'[]',null,false)$$,'42501',null,'admin cannot invoke collector');
reset role;
set local role service_role;
select throws_ok($$update ita_reports set body='changed'$$,'55000','ita_source_is_immutable','source text cannot change');
select throws_ok($$delete from ita_reports$$,'42501',null,'service cannot delete evidence');
select lives_ok($$update ita_reports set extraction='{}',extracted_at=now()$$,'service stores extraction');
select throws_ok($$select save_ita_feed(gen_random_uuid(),1,'[]','"bad"',false)$$,'55000','ita_source_lease_lost','unleased worker cannot checkpoint');
select is((select etag from ita_feed_state where singleton),null::text,'rejected checkpoint preserved');
reset role;
select is((select count(*) from text_sources where key='ita_website'),0::bigint,'ITA cannot enter official fire text pipeline');
create temporary table ita_before as select
 (select count(*) from official_incidents) incidents,
 (select count(*) from incident_mentions) mentions,
 (select count(*) from broadcasts) broadcasts;
select public.enqueue_due_source_jobs(now(),'database');
select set_config('ita.job',id::text,true),set_config('ita.attempt',attempt_count::text,true)
 from public.claim_source_job('ita-sql-test','cloudflare','ita_website');
set local role service_role;
select is(public.save_ita_feed(current_setting('ita.job')::uuid,current_setting('ita.attempt')::integer,
 '[{"source_post_id":"second","source_page":"traficalg","source_url":"https://www.facebook.com/traficalg/posts/second","published_at":"2026-09-08T18:35:11Z","content_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","body":"original","raw":{}}]', '"v1"',false),1,'new report stored');
select is((select etag from ita_feed_state where singleton),'"v1"','successful batch commits ETag');
select is(public.save_ita_feed(current_setting('ita.job')::uuid,current_setting('ita.attempt')::integer,
 '[{"source_post_id":"second","source_page":"traficalg","source_url":"https://www.facebook.com/traficalg/posts/second","published_at":"2026-09-08T18:35:11Z","content_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","body":"original","raw":{}}]', '"v1"',false),0,'replayed feed deduplicates');
select throws_ok($$select save_ita_feed(current_setting('ita.job')::uuid,current_setting('ita.attempt')::integer,
 '[{"source_post_id":"invalid"}]','"invalid"',false)$$,'23502',null,'invalid batch fails');
select is((select etag from ita_feed_state where singleton),'"v1"','invalid batch leaves checkpoint intact');
select is(public.save_ita_feed(current_setting('ita.job')::uuid,current_setting('ita.attempt')::integer,
 '[{"source_post_id":"second","source_page":"traficalg","source_url":"https://www.facebook.com/traficalg/posts/second","published_at":"2026-09-08T18:35:11Z","content_hash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","body":"edited","raw":{}}]', '"v2"',false),1,'edited report is another revision');
select is((select count(*) from ita_reports where source_post_id='second'),2::bigint,'both revisions retained');
select is((select count(*) from ita_reports where source_post_id='post'),1::bigint,'absent reports retained');
select is(public.save_ita_feed(current_setting('ita.job')::uuid,current_setting('ita.attempt')::integer,'[]','"v2"',true),0,'304 does not insert');
select is((select count(*) from claim_ita_extractions(current_setting('ita.job')::uuid,current_setting('ita.attempt')::integer,5)),2::bigint,'304 backlog can be claimed');
select is((select count(*) from claim_ita_extractions(current_setting('ita.job')::uuid,current_setting('ita.attempt')::integer,5)),0::bigint,'claimed reports back off');
select is((select min(extraction_attempts) from ita_reports where source_post_id='second'),1,'attempt recorded before model call');
select lives_ok($$select finish_ita_extraction(current_setting('ita.job')::uuid,current_setting('ita.attempt')::integer,
 (select id from ita_reports where content_hash=repeat('b',64)),null,'model unavailable')$$,'failed extraction persisted');
select is((select extraction_error from ita_reports where content_hash=repeat('b',64)),'model unavailable','failure visible');
update ita_reports set extraction_attempts=5,next_extraction_at=clock_timestamp()-interval '1 day' where content_hash=repeat('b',64);
update ita_reports set next_extraction_at=clock_timestamp()-interval '1 day' where content_hash=repeat('c',64);
select is((select count(*) from claim_ita_extractions(current_setting('ita.job')::uuid,current_setting('ita.attempt')::integer,5)),1::bigint,'exhausted retries excluded while eligible report retries');
select is((select extraction_attempts from ita_reports where content_hash=repeat('c',64)),2,'retry increments attempt durably');
select lives_ok($$select release_ita_extraction(current_setting('ita.job')::uuid,current_setting('ita.attempt')::integer,
 (select id from ita_reports where content_hash=repeat('c',64)))$$,'provider outage releases a claimed report');
select is((select extraction_attempts from ita_reports where content_hash=repeat('c',64)),1,'released report gets its attempt back');
select is((select count(*) from claim_ita_extractions(current_setting('ita.job')::uuid,current_setting('ita.attempt')::integer,5)),1::bigint,'released report is due again at once');
select throws_ok($$select save_ita_feed(current_setting('ita.job')::uuid,current_setting('ita.attempt')::integer+1,'[]','"wrong"',false)$$,'55000','ita_source_lease_lost','different attempt cannot use active lease');
select is((select etag from ita_feed_state where singleton),'"v2"','fenced attempt leaves checkpoint unchanged');
reset role;
update source_job_leases set lease_expires_at=clock_timestamp()-interval '1 second',leased_at=clock_timestamp()-interval '1 hour' where contract_key='ita_website';
set local role service_role;
select throws_ok($$select save_ita_feed(current_setting('ita.job')::uuid,current_setting('ita.attempt')::integer,'[]','"stale"',false)$$,'55000','ita_source_lease_lost','expired worker cannot overwrite checkpoint');
select throws_ok($$select finish_ita_extraction(current_setting('ita.job')::uuid,current_setting('ita.attempt')::integer,
 (select id from ita_reports where content_hash=repeat('b',64)),'{}',null)$$,'55000','ita_source_lease_lost','expired worker cannot finish extraction');
select throws_ok($$select release_ita_extraction(current_setting('ita.job')::uuid,current_setting('ita.attempt')::integer,
 (select id from ita_reports where content_hash=repeat('c',64)))$$,'55000','ita_source_lease_lost','expired worker cannot release extraction');
reset role;
select ok((select incidents=(select count(*) from official_incidents) and mentions=(select count(*) from incident_mentions)
 and broadcasts=(select count(*) from broadcasts) from ita_before),'ITA never creates official incidents, mentions, or broadcasts');
select * from finish();
rollback;
