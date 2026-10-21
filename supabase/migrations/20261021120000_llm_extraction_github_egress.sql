-- the ChatGPT plan's endpoint refuses Cloudflare egress; public-source model calls run on a GitHub runner
update public.source_contracts set execution_target = 'github'
where key in ('dgpc_telegram', 'ita_website');
