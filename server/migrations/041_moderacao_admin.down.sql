delete from feature_flags where chave in ('kill_eventos','kill_render','kill_publicacao','estabelecimentos');
drop table if exists admin_city_resolutions, moderation_actions, reports cascade;
