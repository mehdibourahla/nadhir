-- normalizeArabic now folds the Persian heh and yeh in 16 gazetteer names; v7 retries the bulletins they quarantined
update public.source_contracts set parser_version='dgpc-extract-v7' where key='dgpc_telegram';
