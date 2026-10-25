alter table if exists venues drop constraint if exists venues_pedido_fk;
drop table if exists venue_requests, aggregated_venue_metrics, venue_clicks, venue_visits, coupon_redemptions, coupons, venue_events, sponsorships, venue_links, venue_photos, venues, link_domain_allowlist cascade;
