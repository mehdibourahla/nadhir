begin;
set local search_path = public, extensions;
select plan(13);
select is((select cadence_minutes from source_contracts where key='ita_facebook'),2,'two-minute schedule on GitHub runners');
select is((select replay_capability from source_contracts where key='ita_facebook'),'none','no gap replay');
set local role authenticated;
select throws_ok($$select save_ita_facebook_posts(gen_random_uuid(),1,'[]')$$,'42501',null,'users cannot invoke the collector');
reset role;
set local role service_role;
select throws_ok($$select save_ita_facebook_posts(gen_random_uuid(),1,'[]')$$,'55000','ita_source_lease_lost','unleased worker cannot store');
reset role;
select public.enqueue_due_source_jobs(now(),'database');
select set_config('fb.job',id::text,true),set_config('fb.attempt',attempt_count::text,true)
 from public.claim_source_job('ita-fb-test','github','ita_facebook');
select set_config('web.job',id::text,true),set_config('web.attempt',attempt_count::text,true)
 from public.claim_source_job('ita-web-test','cloudflare','ita_website');
set local role service_role;
select is(ita_text_key(E'#حادث_مرور #iAccident🚨🚨 \n\nحادث مرور بالطريق الاجتنابي الشمالي بلوزداد اتجاه جامع الجزائر.'),ita_text_key(E'🚨🚨 \n\nحادث مرور بالطريق الاجتنابي الشمالي بلوزداد اتجاه جامع الجزائر.'),'hashtags, emoji and spacing do not change the key');
select is(save_ita_facebook_posts(current_setting('fb.job')::uuid,current_setting('fb.attempt')::integer,
 jsonb_build_array(jsonb_build_object('source_post_id','808412572528916_1','source_page','traficalg','source_url','https://www.facebook.com/traficalg/posts/1','published_at','2026-09-28T09:40:06Z','content_hash',repeat('a',64),'body',E'#حادث_مرور #iAccident🚨🚨 \n\nحادث مرور بالطريق الاجتنابي الشمالي بلوزداد اتجاه جامع الجزائر.','raw','{}'::jsonb))),
 1,'new Facebook post stored');
select is(save_ita_facebook_posts(current_setting('fb.job')::uuid,current_setting('fb.attempt')::integer,
 jsonb_build_array(jsonb_build_object('source_post_id','808412572528916_1','source_page','traficalg','source_url','https://www.facebook.com/traficalg/posts/1','published_at','2026-09-28T09:40:06Z','content_hash',repeat('b',64),'body',E'#حادث_مرور #iAccident🚨🚨 \n\nحادث مرور بالطريق الاجتنابي الشمالي بلوزداد اتجاه جامع الجزائر.','raw','{}'::jsonb))),
 0,'same text again stores nothing');
select is(save_ita_feed(current_setting('web.job')::uuid,current_setting('web.attempt')::integer,
 jsonb_build_array(jsonb_build_object('source_post_id','808412572528916_1','source_page','traficalg','source_url','https://www.facebook.com/traficalg/posts/1','published_at','2026-09-28T09:40:06Z','content_hash',repeat('c',64),'body',E'🚨🚨 \n\nحادث مرور بالطريق الاجتنابي الشمالي بلوزداد اتجاه جامع الجزائر.','raw','{"region":"Alger","type":["iAccident"]}'::jsonb)),'"v1"',false),
 0,'the website''s rewrite of a stored post adds no revision');
select is(save_ita_feed(current_setting('web.job')::uuid,current_setting('web.attempt')::integer,
 jsonb_build_array(jsonb_build_object('source_post_id','808412572528916_1','source_page','traficalg','source_url','https://www.facebook.com/traficalg/posts/1','published_at','2026-09-28T09:40:06Z','content_hash',repeat('d',64),'body',E'🚨🚨 \n\nحادث مرور بالطريق الاجتنابي الشمالي بلوزداد اتجاه جامع الجزائر. حركة السير بطيئة.','raw','{}'::jsonb)),'"v2"',false),
 1,'edited text is a revision');
select is(save_ita_facebook_posts(current_setting('fb.job')::uuid,current_setting('fb.attempt')::integer,
 jsonb_build_array(jsonb_build_object('source_post_id','808412572528916_1','source_page','traficalg','source_url','https://www.facebook.com/traficalg/posts/1','published_at','2026-09-28T09:40:06Z','content_hash',repeat('e',64),'body',E'#حادث_مرور #iAccident🚨🚨 \n\nحادث مرور بالطريق الاجتنابي الشمالي بلوزداد اتجاه جامع الجزائر. حركة السير بطيئة.','raw','{}'::jsonb))),
 0,'Facebook copy of the edit adds nothing');
select is(save_ita_facebook_posts(current_setting('fb.job')::uuid,current_setting('fb.attempt')::integer,
 jsonb_build_array(
  jsonb_build_object('source_post_id','808412572528916_2','source_page','traficalg','source_url','https://www.facebook.com/traficalg/posts/2','published_at','2026-09-28T09:41:03Z','content_hash',repeat('f',64),'body','truck stopped in lane one','raw','{}'::jsonb),
  jsonb_build_object('source_post_id','808412572528916_2','source_page','traficalg','source_url','https://www.facebook.com/traficalg/posts/2','published_at','2026-09-28T09:41:03Z','content_hash',repeat('9',64),'body','truck stopped in lane one','raw','{}'::jsonb))),
 1,'a repeated post inside one batch stores once');
select is((select count(*) from ita_reports where source_post_id='808412572528916_1'),2::bigint,'one row per distinct text');
select throws_ok($$select save_ita_facebook_posts(current_setting('fb.job')::uuid,current_setting('fb.attempt')::integer+1,'[]')$$,'55000','ita_source_lease_lost','different attempt cannot use the lease');
reset role;
select * from finish();
rollback;
