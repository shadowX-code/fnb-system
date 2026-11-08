-- Add a social Inbox scope without changing existing channel or unscoped callers.
do $migration$
declare
 signature regprocedure;
 definition text;
 previous_scope text := $scope$(p_channel='social' and c.channel<>'internal')$scope$;
 social_scope text := $scope$(p_channel='social_inbox' and c.channel in ('facebook','instagram'))$scope$;
 allowed_channels text := $channels$('','social','internal','facebook','instagram','whatsapp')$channels$;
begin
 foreach signature in array array[
  'public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean,text)'::regprocedure,
  'public.marketing_inbox_analytics(uuid,uuid,text,timestamptz,timestamptz)'::regprocedure
 ] loop
  definition := pg_get_functiondef(signature);
  if position(previous_scope in definition)=0 or position(allowed_channels in definition)=0 then
   raise exception 'Unexpected Inbox channel projection in %', signature;
  end if;
  definition := replace(definition, allowed_channels, $channels$('','social','internal','facebook','instagram','whatsapp','social_inbox')$channels$);
  execute replace(definition, previous_scope, previous_scope || ' or ' || social_scope);
 end loop;
end;
$migration$;

-- Add both workspace counts to the existing poll and retain its activity and sound evidence.
do $migration$
declare
 definition text := pg_get_functiondef('public.marketing_inbox_reply_count(uuid,uuid)'::regprocedure);
 previous_count text := $count$(select count(*) from scoped c where marketing_private.inbox_needs_reply(c.id)),$count$;
 workspace_counts text := $count$(select count(*) from scoped c where marketing_private.inbox_needs_reply(c.id)),
  (select jsonb_build_object(
    'inbox',count(*) filter(where c.channel<>'whatsapp'),
    'whatsapp',count(*) filter(where c.channel='whatsapp')
   ) from scoped c where marketing_private.inbox_needs_reply(c.id)),$count$;
begin
 if position(previous_count in definition)=0
 or position('into n,token,events_;' in definition)=0
 or position($result$'needs_reply',n,'change_token'$result$ in definition)=0 then
  raise exception 'Unexpected Inbox reply-count projection';
 end if;
 definition := replace(definition,'events_ jsonb;','events_ jsonb; workspace_counts_ jsonb;');
 definition := replace(definition,previous_count,workspace_counts);
 definition := replace(definition,'into n,token,events_;','into n,workspace_counts_,token,events_;');
 definition := replace(definition,$result$'needs_reply',n,'change_token'$result$,
  $result$'needs_reply',n,'needs_reply_by_workspace',workspace_counts_,'change_token'$result$);
 execute definition;
end;
$migration$;
