begin;
set local search_path=public,extensions;
select no_plan();

insert into source_contracts(key,version,label,family,criticality,freshness_basis,cadence_minutes,warning_after_minutes,stale_after_minutes,parser_version,licence,attribution,owner)
values('test.recovery-policy',1,'test','official_text','optional','last_success_at',15,30,60,'version-A','test','test','test'),
('test.recovery-other',1,'other','official_text','optional','last_success_at',15,30,60,'version-A','test','test','test');
insert into text_sources(id,key,label,kind,url,authority_tier) values
('18000000-0000-4000-8000-000000000001','test.recovery-policy','test','telegram_public','https://example.invalid/test','national'),
('18000000-0000-4000-8000-000000000002','test.recovery-other','other','telegram_public','https://example.invalid/other','national');
insert into source_documents(id,text_source_id,external_id,url,published_at,content_hash,body)
select ('18000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
case when n=13 then '18000000-0000-4000-8000-000000000002'::uuid else '18000000-0000-4000-8000-000000000001'::uuid end,
n::text,'https://example.invalid/'||n,now(),'fixture','private source text'
from generate_series(10,13) n;
insert into document_extractions(document_id,attempts,last_error)
select id,case when external_id='11' then 1 else 4 end,'private interpretation error'
from source_documents where text_source_id in ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000002')
on conflict(document_id) do update set attempts=excluded.attempts,last_error=excluded.last_error;
delete from document_extractions where document_id='18000000-0000-4000-8000-000000000012';
insert into source_jobs(id,contract_key,contract_version,trigger_kind,idempotency_key,scheduled_for,data_from,data_through,execution_target,state,attempt_count,max_attempts,retry_base_seconds,retry_until)
values('18000000-0000-4000-8000-000000000020','test.recovery-policy',1,'manual','recovery-policy-test',now(),now()-interval '1 hour',now(),'cloudflare','running',2,3,60,now()+interval '1 hour'),
('18000000-0000-4000-8000-000000000021','ita_website',1,'manual','recovery-policy-ita',now(),now()-interval '1 hour',now(),'cloudflare','running',2,3,60,now()+interval '1 hour');
delete from source_job_leases where contract_key='ita_website';
insert into source_job_leases(contract_key,job_id,worker_id,attempt,leased_at,lease_expires_at) values
('test.recovery-policy','18000000-0000-4000-8000-000000000020','test',2,now(),now()+interval '1 hour'),
('ita_website','18000000-0000-4000-8000-000000000021','test',2,now(),now()+interval '1 hour');

select ok((select relrowsecurity from pg_class where oid='source_recovery_events'::regclass),'recovery audit has RLS');
select ok(not has_table_privilege('anon','source_recovery_events','select') and not has_table_privilege('authenticated','source_recovery_events','select'),'recovery audit is private');
set local role anon;
select throws_ok($$select prepare_source_recovery('test.recovery-policy','18000000-0000-4000-8000-000000000020',2)$$,'42501',null,'anonymous recovery forbidden');
set local role authenticated;
select throws_ok($$select prepare_source_recovery('test.recovery-policy','18000000-0000-4000-8000-000000000020',2)$$,'42501',null,'authenticated recovery forbidden');
set local role service_role;
select throws_ok($$select prepare_source_recovery('test.recovery-policy','18000000-0000-4000-8000-000000000020',1)$$,'P0001','source_recovery_lease_lost','stale attempt cannot recover');
select throws_ok($$select prepare_source_recovery('test.recovery-policy','18000000-0000-4000-8000-000000000021',2)$$,'P0001','source_recovery_lease_lost','other source job cannot recover');
select throws_ok($$select prepare_source_recovery('test.recovery-policy',null,null)$$,'P0001','source_recovery_lease_lost','missing lease cannot recover');
reset role;
update source_job_leases set leased_at=now()-interval '1 hour',lease_expires_at=now()-interval '1 second' where contract_key='test.recovery-policy';
set local role service_role;
select throws_ok($$select prepare_source_recovery('test.recovery-policy','18000000-0000-4000-8000-000000000020',2)$$,'P0001','source_recovery_lease_lost','expired worker cannot recover');
reset role;
update source_job_leases set lease_expires_at=now()+interval '1 hour' where contract_key='test.recovery-policy';
select ok((select next_attempt_at between now()+interval '119 seconds' and now()+interval '130 seconds' from document_extractions where document_id='18000000-0000-4000-8000-000000000011'),'first failed attempt backs off two minutes');
update document_extractions set attempts=2 where document_id='18000000-0000-4000-8000-000000000011';
select ok((select next_attempt_at between now()+interval '239 seconds' and now()+interval '250 seconds' from document_extractions where document_id='18000000-0000-4000-8000-000000000011'),'second failed attempt doubles backoff');
set local role service_role;
select throws_ok($$select prepare_source_recovery('test.recovery-policy','18000000-0000-4000-8000-000000000020',2,'older-parser')$$,'P0001','source_recovery_version_mismatch','old runtime cannot consume a new recovery budget');
select is((select attempts from document_extractions where document_id='18000000-0000-4000-8000-000000000010'),4,'version mismatch preserves exhausted budget');
select is((select count(*) from source_recovery_events where subject_id='18000000-0000-4000-8000-000000000010'),0::bigint,'version mismatch creates no recovery audit');
select is(prepare_source_recovery('test.recovery-policy','18000000-0000-4000-8000-000000000020',2),1,'new version recovers one exhausted document');
select is((select attempts from document_extractions where document_id='18000000-0000-4000-8000-000000000010'),0,'exhausted document receives fresh budget');
select is((select attempts from document_extractions where document_id='18000000-0000-4000-8000-000000000011'),2,'pending work keeps consumed attempts');
select ok((select next_attempt_at>now()+interval '239 seconds' from document_extractions where document_id='18000000-0000-4000-8000-000000000011'),'new version does not bypass pending backoff');
select is((select last_error from document_extractions where document_id='18000000-0000-4000-8000-000000000010'),'private interpretation error','recovery preserves diagnostic error');
select is((select previous_attempts from source_recovery_events where subject_id='18000000-0000-4000-8000-000000000010'),4,'audit preserves exhausted attempts');
select is((select previous_error from source_recovery_events where subject_id='18000000-0000-4000-8000-000000000010'),'private interpretation error','audit preserves failure context');
select is((select attempts from document_extractions where document_id='18000000-0000-4000-8000-000000000013'),4,'another source remains quarantined');
select is((select count(*) from document_extractions where document_id='18000000-0000-4000-8000-000000000012'),0::bigint,'completed document is not recreated');
update document_extractions set attempts=4 where document_id='18000000-0000-4000-8000-000000000010';
select is(prepare_source_recovery('test.recovery-policy','18000000-0000-4000-8000-000000000020',2),0,'same version does not recover twice');
select is((select attempts from document_extractions where document_id='18000000-0000-4000-8000-000000000010'),4,'same version cannot reset exhausted budget');
reset role;
update source_contracts set parser_version='version-B' where key='test.recovery-policy';
set local role service_role;
select is(prepare_source_recovery('test.recovery-policy','18000000-0000-4000-8000-000000000020',2),1,'new version allows one additional recovery');
update document_extractions set attempts=4 where document_id='18000000-0000-4000-8000-000000000010';
reset role;
update source_contracts set parser_version='version-A' where key='test.recovery-policy';
set local role service_role;
select is(prepare_source_recovery('test.recovery-policy','18000000-0000-4000-8000-000000000020',2),0,'returning to prior version creates no new recovery');
select is((select attempts from document_extractions where document_id='18000000-0000-4000-8000-000000000010'),4,'A to B to A cannot reset budget twice for A');
select is((select count(*) from source_recovery_events where subject_id='18000000-0000-4000-8000-000000000010'),2::bigint,'exactly one immutable audit per target version');
reset role;

insert into ita_reports(id,source_post_id,source_page,source_url,published_at,content_hash,body,raw,extraction_attempts,extraction_error,extraction)
select ('18000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,n::text,'test-recovery','https://example.invalid/'||n,now(),repeat('a',64),'private report','{}',5,'private ITA error',case when n=31 then '{}'::jsonb else null end
from generate_series(30,31) n;
update source_contracts set parser_version='version-A' where key='ita_website';
set local role service_role;
select throws_ok($$select prepare_source_recovery('ita_website','18000000-0000-4000-8000-000000000021',2)$$,'P0001','source_recovery_version_mismatch','legacy ITA runtime cannot consume a new recovery budget');
select is((select extraction_attempts from ita_reports where id='18000000-0000-4000-8000-000000000030'),5,'legacy ITA call leaves quarantine intact');
select lives_ok($$select prepare_source_recovery('ita_website','18000000-0000-4000-8000-000000000021',2,'version-A')$$,'ITA recovery succeeds with matching parser and own lease');
select is((select extraction_attempts from ita_reports where id='18000000-0000-4000-8000-000000000030'),0,'ITA exhausted report is requeued');
select is((select extraction_attempts from ita_reports where id='18000000-0000-4000-8000-000000000031'),5,'completed ITA report is not requeued');
select is((select extraction_error from ita_reports where id='18000000-0000-4000-8000-000000000030'),'private ITA error','ITA error survives recovery');
update ita_reports set extraction_attempts=5 where id='18000000-0000-4000-8000-000000000030';
select lives_ok($$select prepare_source_recovery('ita_website','18000000-0000-4000-8000-000000000021',2,'version-A')$$,'repeated ITA recovery is safe');
select is((select extraction_attempts from ita_reports where id='18000000-0000-4000-8000-000000000030'),5,'same version cannot replenish ITA budget');
reset role;
update source_contracts set parser_version='version-B' where key='ita_website';
set local role service_role;
select lives_ok($$select prepare_source_recovery('ita_website','18000000-0000-4000-8000-000000000021',2,'version-B')$$,'ITA receives new-version recovery');
update ita_reports set extraction_attempts=5 where id='18000000-0000-4000-8000-000000000030';
reset role;
update source_contracts set parser_version='version-A' where key='ita_website';
set local role service_role;
select lives_ok($$select prepare_source_recovery('ita_website','18000000-0000-4000-8000-000000000021',2,'version-A')$$,'ITA version rollback is safe');
select is((select extraction_attempts from ita_reports where id='18000000-0000-4000-8000-000000000030'),5,'ITA A to B to A cannot replenish budget');
select is((select count(*) from source_recovery_events where subject_id='18000000-0000-4000-8000-000000000030'),2::bigint,'ITA recovery history retains one record per version');
select ok(exists(select 1 from source_watchdog where contract_key='test.recovery-policy' and issue_code='processing_quarantined'),'watchdog exposes quarantined work');
select throws_ok($$update source_recovery_events set previous_error='erased'$$,'42501',null,'worker cannot rewrite recovery audit');
select throws_ok($$delete from source_recovery_events$$,'42501',null,'worker cannot erase recovery audit');
insert into source_captures(source_key,endpoint,source_origin,requested_at,fetched_at,status,http_status,byte_length)
values('test.recovery-policy','feed','https://example.invalid',now()-interval '2 minutes',now()-interval '2 minutes','not_modified',304,0);
insert into source_captures(source_key,endpoint,source_origin,requested_at,fetched_at,status,error_code)
values('test.recovery-policy','feed','https://example.invalid',now(),now(),'failed','network_error');
set local role anon;
select is((select pending from source_processing_health() where key='test.recovery-policy'),1::bigint,'public health counts unfinished retryable work');
select is((select quarantined from source_processing_health() where key='test.recovery-policy'),1::bigint,'public health separates quarantined work');
select is((select collection_at from source_processing_health() where key='test.recovery-policy'),now()-interval '2 minutes','successful collection remains visible despite quarantined processing and later fetch failure');
select is((select array_agg(k order by k) from source_processing_health() h cross join lateral jsonb_object_keys(to_jsonb(h)) k where h.key='test.recovery-policy'),array['collection_at','key','pending','quarantined'],'public health exposes only aggregate fields');
select throws_ok($$select previous_error from source_recovery_events$$,'42501',null,'public health cannot expose private recovery errors');
reset role;
insert into source_documents(id,text_source_id,external_id,url,published_at,content_hash,body)
select '18000000-0000-4000-8000-000000000040',id,'parser-version-guard','https://example.invalid/dgpc-version',now(),'fixture','private source text'
from text_sources where key='dgpc_telegram';
insert into document_extractions(document_id,attempts,last_error,recovery_version)
values('18000000-0000-4000-8000-000000000040',4,'parser interpretation error','dgpc-extract-v4')
on conflict(document_id) do update set attempts=4,recovery_version='dgpc-extract-v4';
insert into source_jobs(id,contract_key,contract_version,trigger_kind,idempotency_key,scheduled_for,data_from,data_through,execution_target,state,attempt_count,max_attempts,retry_base_seconds,retry_until)
values('18000000-0000-4000-8000-000000000041','dgpc_telegram',1,'manual','dgpc-parser-version-test',now(),now()-interval '1 hour',now(),'cloudflare','running',2,3,60,now()+interval '1 hour');
delete from source_job_leases where contract_key='dgpc_telegram';
insert into source_job_leases(contract_key,job_id,worker_id,attempt,leased_at,lease_expires_at)
values('dgpc_telegram','18000000-0000-4000-8000-000000000041','test',2,now(),now()+interval '1 hour');
set local role service_role;
select throws_ok($$select prepare_source_recovery('dgpc_telegram','18000000-0000-4000-8000-000000000041',2)$$,'P0001','source_recovery_version_mismatch','legacy DGPC worker cannot spend v6 budget');
select throws_ok($$select prepare_source_recovery('dgpc_telegram','18000000-0000-4000-8000-000000000041',2,'dgpc-extract-v5')$$,'P0001','source_recovery_version_mismatch','rolled-back DGPC worker fails closed');
select is((select attempts from document_extractions where document_id='18000000-0000-4000-8000-000000000040'),4,'version mismatch preserves DGPC quarantine');
select lives_ok($$select prepare_source_recovery('dgpc_telegram','18000000-0000-4000-8000-000000000041',2,'dgpc-extract-v6')$$,'deployed DGPC v6 worker can recover');
select is((select attempts from document_extractions where document_id='18000000-0000-4000-8000-000000000040'),0,'deployed parser receives its new budget');
update document_extractions set attempts=4 where document_id='18000000-0000-4000-8000-000000000040';
select is(prepare_source_recovery('dgpc_telegram','18000000-0000-4000-8000-000000000041',2,'dgpc-extract-v6'),0,'same deployed parser never replenishes DGPC budget twice');
select is((select count(*) from source_recovery_events where subject_id='18000000-0000-4000-8000-000000000040'),1::bigint,'DGPC recovery records exactly one v6 audit');
reset role;
select * from finish();
rollback;
