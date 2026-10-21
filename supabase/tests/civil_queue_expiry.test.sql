begin;
set local search_path=public,extensions;
select plan(9);

select is(array[civil_lease('road'),civil_lease('fire'),civil_lease('flood'),civil_lease('weather'),civil_lease('other')],
  array[interval '2 hours',interval '3 hours',interval '6 hours',interval '6 hours',interval '6 hours'],
  'the SQL lease matches civilLeaseHours');

insert into ita_reports(id,source_post_id,source_page,source_url,published_at,content_hash,body,raw,extraction)
select ('1a000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'expiry-' || n,'traficalg','https://www.facebook.com/traficalg/posts/expiry-' || n,
  now()-hours*interval '1 hour',repeat(n::text,64),'Source','{}',
  jsonb_build_object('disposition','incident_report','incidents',jsonb_build_array(jsonb_build_object('kind',kind,'summary_fr','Résumé','evidence','Source')),'review_reasons','[]'::jsonb)
from (values (1,3,'collision'),(2,2,'fire'),(3,3,'collision'),(4,5,'other'),(5,3,'collision'),(6,3,'collision'),(7,5,'unexpected'),(8,3,'collision')) v(n,hours,kind);

insert into civil_investigations(id,report_id,incident_index,state,next_attempt_at)
select ('1a000000-0000-4000-8000-1' || lpad(n::text,11,'0'))::uuid,('1a000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,0,state,now()+interval '1 hour'
from (values (1,'review'),(2,'review'),(3,'review'),(4,'hold'),(5,'processing'),(6,'pending'),(7,'failed'),(8,'failed')) v(n,state);

insert into civil_decisions(investigation_id,attempt,decision,trace,model,version,source_extraction)
select ('1a000000-0000-4000-8000-1' || lpad(n::text,11,'0'))::uuid,1,jsonb_build_object('outcome','review','hazard',hazard),'[]','test','civil-agent-v2','{}'
from (values (1,'road'),(2,'fire'),(3,'weather'),(4,'other')) v(n,hazard);

select enqueue_due_source_jobs(now(),'database');
select set_config('expiry.job',id::text,true),set_config('expiry.attempt',attempt_count::text,true)
  from claim_source_job('queue-expiry-sql-test','cloudflare','ita_website');
set local role service_role;
select count(*) from claim_civil_investigations(current_setting('expiry.job')::uuid,current_setting('expiry.attempt')::integer,0);
reset role;

select is((select state from civil_investigations where report_id='1a000000-0000-4000-8000-000000000001'),'expired','a road review past its 2 h lease leaves the queue');
select is((select state from civil_investigations where report_id='1a000000-0000-4000-8000-000000000002'),'review','a fire review inside its 3 h lease stays');
select is((select state from civil_investigations where report_id='1a000000-0000-4000-8000-000000000003'),'review','the decision''s hazard outranks the extracted kind');
select is((select state from civil_investigations where report_id='1a000000-0000-4000-8000-000000000004'),'hold','a hold inside its 6 h lease stays');
select is((select state from civil_investigations where report_id='1a000000-0000-4000-8000-000000000005'),'processing','running work is never expired under the worker');
select is((select state from civil_investigations where report_id='1a000000-0000-4000-8000-000000000006'),'expired','undecided work falls back to the extracted kind');
select is((select state from civil_investigations where report_id='1a000000-0000-4000-8000-000000000007'),'failed','an unknown kind gets the longest lease');
select is((select state from civil_investigations where report_id='1a000000-0000-4000-8000-000000000008'),'expired','a failure past its lease leaves the queue');

select * from finish();
rollback;
