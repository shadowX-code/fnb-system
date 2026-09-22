-- Crew notification reads validate the opaque session token. The canonical
-- resolver updates last_seen_at, so these RPCs must be volatile rather than
-- stable even though their user-facing purpose is a read.
alter function public.crew_notification_unread_count(text) volatile;
alter function public.crew_notifications_page(text, boolean, integer, integer) volatile;
