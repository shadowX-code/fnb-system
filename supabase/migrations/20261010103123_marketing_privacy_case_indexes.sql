-- Cover restricted privacy-case references without changing retention or access.
create index inbox_legal_holds_case on marketing_private.inbox_legal_holds(case_hash);
create index privacy_case_receipts_case on marketing_private.privacy_case_receipts(case_hash);
create index meta_removal_case on marketing_private.removal_requests(case_hash);
