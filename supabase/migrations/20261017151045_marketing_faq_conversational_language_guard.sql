-- Conservative multilingual conversational phrases; uncertain vocabulary still requires factual support.
create or replace function marketing_private.inbox_answer_requirement(answer_ text) returns text language plpgsql immutable set search_path=public as $$
declare t text:=lower(normalize(coalesce(answer_,''),NFKC)); remainder text;
begin
 if length(btrim(t))=0 then return 'uncertain';end if;
 if t ~ '(https?://|www\.|[0-9@]|rm[[:space:]]|price|cost|hour|open|clos|menu|address|location|offer|discount|promo|book|reserv|deliver|refund|allerg|halal|free|stock|available|tomorrow|tonight|营业|开门|关门|菜单|价格|地址|优惠|预订|外送|退款|过敏|免费|有货|明天|harga|pukul|buka|tutup|alamat|diskaun|tempah|penghantaran|percuma)' then return 'factual';end if;
 -- Positive bounded conversational vocabulary, never absence-of-keywords as proof of fact freedom.
 remainder:=regexp_replace(t,'[[:punct:][:space:]，。？！、：；“”‘’]+',' ','g');
 remainder:=regexp_replace(remainder,'(您好|你好|嗨|谢谢您|谢谢你|谢谢|不客气|欢迎|您的|你的|留言|消息|联系|我们|团队成员|团队|协助|处理|问题|有什么|可以|帮您|帮助您|帮你|帮助|请问|请|提供|更多|详情|收到|好的|会由|有什么需要|尽管告诉我们|很高兴|为您服务|的|您|你|吗|呀|呢|啊|感谢|信息|联络|咨询|耐心|理解|支持|很乐意|非常|需要|其他|稍等|稍候)','','g');
 remainder:=regexp_replace(remainder,'\m(hi|hello|hey|there|dear|thanks|thank|you|your|yours|so|much|very|for|the|a|an|and|or|us|we|our|i|me|my|it|is|are|re|welcome|message|messaging|reaching|reach|out|contacting|contact|getting|in|touch|how|can|could|may|help|assist|assistance|please|let|know|what|would|like|to|do|with|more|details|detail|share|tell|question|questions|team|member|members|will|be|happy|glad|of|about|today|this|that|received|noted|ok|okay|sure|no|problem|worries|appreciate|appreciated|kindly|patience|understanding|cheers|great|good|lovely|wonderful|awesome|nice|greetings|checking|delighted|pleased|support|any|anything|else|need|want|tq|hai|helo|salam|terima|kasih|atas|sama|mesej|anda|kami|kita|saya|boleh|bantu|membantu|apa|ada|yang|ingin|sila|kongsi|maklumat|lanjut|soalan|pasukan|ahli|akan|dengan|untuk|telah|diterima|menghubungi|sudi|sangat|menghargai|kesabaran|beritahu|perlukan|lagi|baik|ya|lah|ah)\M','','g');
 if btrim(remainder)='' then return 'conversational';end if;
 return 'uncertain';
end;$$;
