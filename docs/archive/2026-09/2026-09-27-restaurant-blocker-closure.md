# Restaurant release blocker closure — 27 September 2026

## Scope and verdict

Read-only Production forensics; authenticated canonical Staging visual QA only. No Production business data, migrations, deployments, or main merges changed. Payroll candidate and QA were not reopened.

- PO DUPLICATE FORENSICS = COMPLETE
- PO HISTORICAL TREATMENT = retain every historical PO/line/receipt/movement/request unchanged; reserve existing source/supplier keys and enforce prospective creation uniqueness at the database boundary
- PO UNIQUENESS MIGRATION = NEEDS APPROVAL
- SHARED FILTER VISUAL CLOSURE = PASS
- BATCH A = NOT READY (compatibility migration must be approved, implemented and rehearsed)
- BATCH B PAYROLL = READY (independent, previously verified candidate unchanged)
- RESTAURANT PRODUCTION RELEASE = NOT READY

## Production evidence

All seven groups are at **Hola Hola Kopitiam Ipoh**, outlet `834c04b9-cdef-4e31-89eb-965873fcb8b8`, code HLIPH. All reference submitted Scheduled Stock Check **Groceries / Closing / 15 September 2026**, ID `9ce25a41-fe87-4b5b-9454-6b98d6f2505d`, group `6c034083-bd21-4201-a0b5-1691f270b739`. Source submitted at 2026-09-14T16:37:21.637427+00:00. There are exactly 14 POs for that source, no cancelled sibling.

All pairs have identical item IDs, source-line IDs, quantities and UOMs, the same creator, distinct persisted request IDs, and creation separations of 14–281ms. Classification for **every group: likely historical duplicate creation**. No pair has evidence of a legitimate split or separate source identity. This is an inference, not permission to reverse stock or conclude physical deliveries were duplicates.

Eight orders completed fully, five supplier-confirmed, one Draft. Eight distinct receipt headers, 36 receipt lines and 36 Purchase inventory movements persist. Completed pairs are operationally distinct receipt/movement facts even though their creation appears duplicated.

Production has no persisted business_po_no column yet. Business numbers below are **read-only reconstruction of the existing legacy Admin display**, using its UTC date/global daily ordering (created_at, technical po_no), not newly assigned identifiers. No number was written or renumbered.

## Yee Wah

Supplier ID: `0cee3835-b20d-4c3f-b67d-1e6b7ecf436c`. Classification: **likely historical duplicate**. Exact line sets match; creation gap approximately 14ms.

### HLIPH-260914-019

- PO ID: `4fb8bbb1-0108-4b72-88e5-ce10290f1c01`; technical po_no: `PO-985378-36C`.
- Created: 2026-09-14T16:56:25.436995+00:00; updated: 2026-09-17T13:38:51.697+00:00 (UTC).
- Status: completed; submitted: 2026-09-17T13:38:29.952+00:00; confirmed: 2026-09-17T13:38:31.286+00:00.
- Completed: 2026-09-17T13:38:51.697+00:00; completion type: full; unfulfilled quantity: 0; completion reason: —.
- Cancelled: No; cancellation reason: —.

| Item | Ordered | Received | UOM | Source line |
|---|---:|---:|---|---|
| San Remo Sphagetti No.5 | 20 | 20 | pack | b9c5d8ec-282d-4126-b14f-e7ba0e25cdd5 |

Receipts:

- `1097ed00-51b1-4d80-9816-baadc45dba23` at 2026-09-17T13:38:44.978718+00:00; 1 lines; quantities reconcile with PO received totals.

Inventory movements:

- `ac2b5fdc-144d-4d82-9bc3-ce304db3fd00` — Purchase +20 pack, item `c0421316-fd07-4761-aee9-881358d82b91`, 2026-09-17T13:38:44.978718+00:00; reference purchase_order `4fb8bbb1-0108-4b72-88e5-ce10290f1c01`.

Lifecycle request/audit evidence:

- `d4e156df-60c7-4806-a7c8-0d2f5d8679d5` — purchase_order, 2026-09-14T16:56:25.436995+00:00.
- `ab79746e-b1cc-45ae-ad66-9b0642e316c9` — purchase_receipt, 2026-09-17T13:38:44.978718+00:00.

### HLIPH-260914-020

- PO ID: `cf4005c0-b422-4cea-a568-394e6a2c0c9e`; technical po_no: `PO-985411-36C`.
- Created: 2026-09-14T16:56:25.4508+00:00; updated: 2026-09-17T13:46:08.36+00:00 (UTC).
- Status: completed; submitted: 2026-09-14T16:58:24.42+00:00; confirmed: 2026-09-14T16:58:26.419+00:00.
- Completed: 2026-09-17T13:46:08.36+00:00; completion type: full; unfulfilled quantity: 0; completion reason: —.
- Cancelled: No; cancellation reason: —.

| Item | Ordered | Received | UOM | Source line |
|---|---:|---:|---|---|
| San Remo Sphagetti No.5 | 20 | 20 | pack | b9c5d8ec-282d-4126-b14f-e7ba0e25cdd5 |

Receipts:

- `d12143d0-304b-4f69-82cf-1d3c4250bf51` at 2026-09-17T13:45:59.548463+00:00; 1 lines; quantities reconcile with PO received totals.

Inventory movements:

- `4cffac26-115f-406f-ac9a-94527c468b84` — Purchase +20 pack, item `c0421316-fd07-4761-aee9-881358d82b91`, 2026-09-17T13:45:59.548463+00:00; reference purchase_order `cf4005c0-b422-4cea-a568-394e6a2c0c9e`.

Lifecycle request/audit evidence:

- `49702889-cdd8-4d1d-b673-627a5a0224c0` — purchase_order, 2026-09-14T16:56:25.4508+00:00.
- `31f9fa6b-84b8-4e6f-9e59-0a0d041118c9` — purchase_receipt, 2026-09-17T13:45:59.548463+00:00.

## Sk Group

Supplier ID: `44b81674-6fc5-407e-b22c-9481491f839d`. Classification: **likely historical duplicate**. Exact line sets match; creation gap approximately 65ms.

### HLIPH-260914-014

- PO ID: `de2d8c26-3407-46fb-a385-cbc04141f538`; technical po_no: `PO-985249-39D`.
- Created: 2026-09-14T16:56:25.292461+00:00; updated: 2026-09-19T14:32:14.265+00:00 (UTC).
- Status: completed; submitted: 2026-09-17T13:46:34.864+00:00; confirmed: 2026-09-17T13:46:45.218+00:00.
- Completed: 2026-09-19T14:32:14.265+00:00; completion type: full; unfulfilled quantity: 0; completion reason: —.
- Cancelled: No; cancellation reason: —.

| Item | Ordered | Received | UOM | Source line |
|---|---:|---:|---|---|
| Mango Diced | 5 | 5 | pack | 6718dd70-b56c-433e-b191-fee1d0e59f3c |

Receipts:

- `f09e44d7-8a7a-41d8-81d5-13efb742423e` at 2026-09-19T14:31:56.873184+00:00; 1 lines; quantities reconcile with PO received totals.

Inventory movements:

- `c8daf3cf-1c62-4646-a61c-d0dbdd29215a` — Purchase +5 pack, item `e7eafd1a-c655-4aca-ad36-1fc6411cda73`, 2026-09-19T14:31:56.873184+00:00; reference purchase_order `de2d8c26-3407-46fb-a385-cbc04141f538`.

Lifecycle request/audit evidence:

- `e58e62d8-2b28-4495-a478-c6cacabde805` — purchase_order, 2026-09-14T16:56:25.292461+00:00.
- `dbe139c0-7d3d-4f52-8ee6-7d364d57a222` — purchase_receipt, 2026-09-19T14:31:56.873184+00:00.

### HLIPH-260914-016

- PO ID: `bf55a1b6-58c9-4e55-a523-a49a745475b2`; technical po_no: `PO-985322-39D`.
- Created: 2026-09-14T16:56:25.357669+00:00; updated: 2026-09-19T14:31:42.349+00:00 (UTC).
- Status: completed; submitted: 2026-09-17T13:46:24.481+00:00; confirmed: 2026-09-17T13:46:26.148+00:00.
- Completed: 2026-09-19T14:31:42.349+00:00; completion type: full; unfulfilled quantity: 0; completion reason: —.
- Cancelled: No; cancellation reason: —.

| Item | Ordered | Received | UOM | Source line |
|---|---:|---:|---|---|
| Mango Diced | 5 | 5 | pack | 6718dd70-b56c-433e-b191-fee1d0e59f3c |

Receipts:

- `4f234d0e-cd23-47d0-85fc-e9aa885ddc76` at 2026-09-19T14:31:25.864989+00:00; 1 lines; quantities reconcile with PO received totals.

Inventory movements:

- `88c87211-5c45-4138-a3a5-6a2e577230a5` — Purchase +5 pack, item `e7eafd1a-c655-4aca-ad36-1fc6411cda73`, 2026-09-19T14:31:25.864989+00:00; reference purchase_order `bf55a1b6-58c9-4e55-a523-a49a745475b2`.

Lifecycle request/audit evidence:

- `02647482-9b90-4164-97c9-48da37ce4a82` — purchase_order, 2026-09-14T16:56:25.357669+00:00.
- `18d60c1d-b040-48d5-9296-18a6a2a16894` — purchase_receipt, 2026-09-19T14:31:25.864989+00:00.

## Dason

Supplier ID: `652f36fd-58ac-42ab-978b-1645b3ee7b39`. Classification: **likely historical duplicate**. Exact line sets match; creation gap approximately 41ms.

### HLIPH-260914-017

- PO ID: `092d20e5-82fa-4c45-9919-dcb790c3d035`; technical po_no: `PO-985312-B39`.
- Created: 2026-09-14T16:56:25.362362+00:00; updated: 2026-09-19T14:31:14.968+00:00 (UTC).
- Status: supplier_confirmed; submitted: 2026-09-17T13:47:12.901+00:00; confirmed: 2026-09-19T14:31:14.968+00:00.
- Completed: —; completion type: —; unfulfilled quantity: 0; completion reason: —.
- Cancelled: No; cancellation reason: —.

| Item | Ordered | Received | UOM | Source line |
|---|---:|---:|---|---|
| Olive Oil 橄榄油 | 2 | 0 | pack | 575dfa78-eae8-457d-9c08-9d8d08221171 |
| Pasteurized Eggs 无菌蛋 | 2 | 0 | tray | 1a836fe7-c9d6-4a67-8925-fe6d86dae995 |
| Teriyaki Sauce | 3 | 0 | btl | 528cbe7d-0b1e-41b5-9ffd-d87584a36a3b |

Receipts:

None.

Inventory movements:

None.

Lifecycle request/audit evidence:

- `05ebd44c-0f71-4e5c-8644-ec1f6cbb2a9f` — purchase_order, 2026-09-14T16:56:25.362362+00:00.

### HLIPH-260914-018

- PO ID: `8241c0a9-644a-4836-858e-f7f71654e634`; technical po_no: `PO-985367-B39`.
- Created: 2026-09-14T16:56:25.40323+00:00; updated: 2026-09-17T13:47:20.3+00:00 (UTC).
- Status: supplier_confirmed; submitted: 2026-09-17T13:47:15.635+00:00; confirmed: 2026-09-17T13:47:20.3+00:00.
- Completed: —; completion type: —; unfulfilled quantity: 0; completion reason: —.
- Cancelled: No; cancellation reason: —.

| Item | Ordered | Received | UOM | Source line |
|---|---:|---:|---|---|
| Teriyaki Sauce | 3 | 0 | btl | 528cbe7d-0b1e-41b5-9ffd-d87584a36a3b |
| Pasteurized Eggs 无菌蛋 | 2 | 0 | tray | 1a836fe7-c9d6-4a67-8925-fe6d86dae995 |
| Olive Oil 橄榄油 | 2 | 0 | pack | 575dfa78-eae8-457d-9c08-9d8d08221171 |

Receipts:

None.

Inventory movements:

None.

Lifecycle request/audit evidence:

- `fb20a9d2-279a-409b-81ef-401358f7214d` — purchase_order, 2026-09-14T16:56:25.40323+00:00.

## Trend Magic

Supplier ID: `6f5d9779-4ee2-4590-9a15-3403da0a4a1f`. Classification: **likely historical duplicate**. Exact line sets match; creation gap approximately 281ms.

### HLIPH-260914-007

- PO ID: `d71ad746-8bb7-4a8c-ad6b-84f586a57ae1`; technical po_no: `PO-984618-A1F`.
- Created: 2026-09-14T16:56:24.748355+00:00; updated: 2026-09-14T16:56:24.748355+00:00 (UTC).
- Status: draft; submitted: —; confirmed: —.
- Completed: —; completion type: —; unfulfilled quantity: 0; completion reason: —.
- Cancelled: No; cancellation reason: —.

| Item | Ordered | Received | UOM | Source line |
|---|---:|---:|---|---|
| 7 Up 24/ctn | 48 | 0 | can | f35912cd-e874-44ad-979c-0030a2011160 |
| Coke 24/ctn | 48 | 0 | can | 463860b8-e05f-470e-b087-ca70af8024b0 |

Receipts:

None.

Inventory movements:

None.

Lifecycle request/audit evidence:

- `b29e70cf-07f9-4a9a-859a-ca46d793243b` — purchase_order, 2026-09-14T16:56:24.748355+00:00.

### HLIPH-260914-009

- PO ID: `751e69f9-3aad-4fc6-91d6-97054531c353`; technical po_no: `PO-984946-A1F`.
- Created: 2026-09-14T16:56:25.029688+00:00; updated: 2026-09-17T13:42:02.254+00:00 (UTC).
- Status: supplier_confirmed; submitted: 2026-09-17T13:42:01.005+00:00; confirmed: 2026-09-17T13:42:02.254+00:00.
- Completed: —; completion type: —; unfulfilled quantity: 0; completion reason: —.
- Cancelled: No; cancellation reason: —.

| Item | Ordered | Received | UOM | Source line |
|---|---:|---:|---|---|
| 7 Up 24/ctn | 48 | 0 | can | f35912cd-e874-44ad-979c-0030a2011160 |
| Coke 24/ctn | 48 | 0 | can | 463860b8-e05f-470e-b087-ca70af8024b0 |

Receipts:

None.

Inventory movements:

None.

Lifecycle request/audit evidence:

- `a00a2956-2321-41f5-93ee-75c05c6e87de` — purchase_order, 2026-09-14T16:56:25.029688+00:00.

## Lh Sales

Supplier ID: `9e9c3aa4-fe42-4079-8571-1c7f412bacdf`. Classification: **likely historical duplicate**. Exact line sets match; creation gap approximately 101ms.

### HLIPH-260914-010

- PO ID: `9ab06733-4a6a-4139-b19d-0666cc3c982b`; technical po_no: `PO-985085-CDF`.
- Created: 2026-09-14T16:56:25.140416+00:00; updated: 2026-09-17T13:41:54.451+00:00 (UTC).
- Status: supplier_confirmed; submitted: 2026-09-17T13:41:53.218+00:00; confirmed: 2026-09-17T13:41:54.451+00:00.
- Completed: —; completion type: —; unfulfilled quantity: 0; completion reason: —.
- Cancelled: No; cancellation reason: —.

| Item | Ordered | Received | UOM | Source line |
|---|---:|---:|---|---|
| Bestari Fried Chicken Powder | 2 | 0 | pack | a23f8307-2c6a-4411-8e04-e46c0b7521de |

Receipts:

None.

Inventory movements:

None.

Lifecycle request/audit evidence:

- `5f631df9-235e-42fe-87c3-1d35763089c7` — purchase_order, 2026-09-14T16:56:25.140416+00:00.

### HLIPH-260914-013

- PO ID: `6fe7b59f-8877-417f-bd9f-074cc5322121`; technical po_no: `PO-985187-CDF`.
- Created: 2026-09-14T16:56:25.24161+00:00; updated: 2026-09-17T13:46:57.233+00:00 (UTC).
- Status: supplier_confirmed; submitted: 2026-09-17T13:46:38.796+00:00; confirmed: 2026-09-17T13:46:57.233+00:00.
- Completed: —; completion type: —; unfulfilled quantity: 0; completion reason: —.
- Cancelled: No; cancellation reason: —.

| Item | Ordered | Received | UOM | Source line |
|---|---:|---:|---|---|
| Bestari Fried Chicken Powder | 2 | 0 | pack | a23f8307-2c6a-4411-8e04-e46c0b7521de |

Receipts:

None.

Inventory movements:

None.

Lifecycle request/audit evidence:

- `79f53660-39a1-4665-89cd-fd56f20a0ca3` — purchase_order, 2026-09-14T16:56:25.24161+00:00.

## Sunho Product

Supplier ID: `ae0ed09d-ed03-406f-b905-2ace16176370`. Classification: **likely historical duplicate**. Exact line sets match; creation gap approximately 134ms.

### HLIPH-260914-008

- PO ID: `03fed49a-157f-4244-bb94-4bfebfed07eb`; technical po_no: `PO-984960-370`.
- Created: 2026-09-14T16:56:25.025754+00:00; updated: 2026-09-17T13:45:38.373+00:00 (UTC).
- Status: completed; submitted: 2026-09-17T13:42:08.535+00:00; confirmed: 2026-09-17T13:42:10.199+00:00.
- Completed: 2026-09-17T13:45:38.373+00:00; completion type: full; unfulfilled quantity: 0; completion reason: —.
- Cancelled: No; cancellation reason: —.

| Item | Ordered | Received | UOM | Source line |
|---|---:|---:|---|---|
| Barley 薏米 | 3 | 3 | pack | eb9df4a7-7543-4041-8678-d69bcc6110fe |
| Oil - Cooking (PCK) | 2 | 2 | carton | c9bdb7f0-92c8-4553-8694-a6fabb96b878 |
| Oil - Cooking (BTL) | 12 | 12 | btl | 3cab3716-90ac-4e75-86b1-f4043fb51b16 |
| Rice 10KG 黄金米 | 6 | 6 | pack | 81b09bfb-61e4-4aad-8a55-9c4528577b6a |
| Cordyceps Flower 虫草花 | 1 | 1 | kg | c57fb417-6571-4965-acf7-0d126de44134 |
| Appalam / Papadam | 10 | 10 | pcs | c41487a9-cfee-4f86-923b-98cdb7d2c34e |
| Maggi Seasoning | 1 | 1 | btl | d7eb2b2f-fbc7-4f9f-8f23-f62095ff1316 |
| Glass Noodle 红鸡冬粉 | 1 | 1 | carton | 54027ef5-9f60-4288-87be-e779a225a509 |
| Honey | 2 | 2 | btl | 3460d897-141c-4d8b-8ed9-7dbd35dc0674 |
| Gula Melaka 椰糖 | 5 | 5 | pcs | 3b14598b-cf27-4c07-97e2-c6aa35731c9f |
| Hup Loong Frying Powder 合隆炸粉 | 20 | 20 | pack | e20a872b-f7c2-4021-a264-3005695d3f0b |
| Red Bean 红豆 | 3 | 3 | pack | 8a71e017-cb28-466e-b8b2-e1e399e0937c |

Receipts:

- `88aaa341-d338-4869-becd-f61101861ef7` at 2026-09-17T13:42:46.331024+00:00; 12 lines; quantities reconcile with PO received totals.

Inventory movements:

- `fa269611-1535-4a79-9e70-d179a4a46e07` — Purchase +10 pcs, item `85b7b71b-5ae1-4b2a-932a-7b7272a6d1cf`, 2026-09-17T13:42:46.331024+00:00; reference purchase_order `03fed49a-157f-4244-bb94-4bfebfed07eb`.
- `036bbe7a-8ee0-46af-b50d-310ab230e9bd` — Purchase +3 pack, item `65004875-4061-4305-963b-5121f08422cd`, 2026-09-17T13:42:46.331024+00:00; reference purchase_order `03fed49a-157f-4244-bb94-4bfebfed07eb`.
- `5fc8d5f8-f9b4-4c8c-ad6a-9bd21d72026f` — Purchase +1 kg, item `2183ef3b-d0f3-4106-b32d-a8a4788dc3b9`, 2026-09-17T13:42:46.331024+00:00; reference purchase_order `03fed49a-157f-4244-bb94-4bfebfed07eb`.
- `cbff3072-ceff-47cc-ac23-7d3b07ade4a8` — Purchase +1 carton, item `54f144c8-d5ab-4f96-81a6-c65504ccf831`, 2026-09-17T13:42:46.331024+00:00; reference purchase_order `03fed49a-157f-4244-bb94-4bfebfed07eb`.
- `7bc0c6f3-cf3d-4ed1-856e-1672cbe96356` — Purchase +5 pcs, item `7a99d676-af05-4db6-93c8-9d91aa20def3`, 2026-09-17T13:42:46.331024+00:00; reference purchase_order `03fed49a-157f-4244-bb94-4bfebfed07eb`.
- `359368b3-a175-46c0-bb70-24617076878e` — Purchase +2 btl, item `a795f26c-4540-4c4e-ab53-5ca2f2823fb8`, 2026-09-17T13:42:46.331024+00:00; reference purchase_order `03fed49a-157f-4244-bb94-4bfebfed07eb`.
- `04852768-9eb7-427c-b291-40a8ede24a5f` — Purchase +20 pack, item `31acae1d-a325-4ee1-8fdd-87d45444638e`, 2026-09-17T13:42:46.331024+00:00; reference purchase_order `03fed49a-157f-4244-bb94-4bfebfed07eb`.
- `e998dd3f-c5da-49a7-a7d2-454d868b5769` — Purchase +1 btl, item `cd8917b0-1a54-4a2e-904e-a48c71ef13dc`, 2026-09-17T13:42:46.331024+00:00; reference purchase_order `03fed49a-157f-4244-bb94-4bfebfed07eb`.
- `28eefa5d-8ef2-4308-9643-8c64a9d7e007` — Purchase +12 btl, item `bacf2ec4-6aa5-476d-8c8b-4dac30221549`, 2026-09-17T13:42:46.331024+00:00; reference purchase_order `03fed49a-157f-4244-bb94-4bfebfed07eb`.
- `7935e5ea-0664-4c4c-97b3-3242d74a72f9` — Purchase +2 carton, item `b073ac1b-656c-4801-a8d1-04fa0396d14e`, 2026-09-17T13:42:46.331024+00:00; reference purchase_order `03fed49a-157f-4244-bb94-4bfebfed07eb`.
- `3db76d80-57fd-4625-9b8e-e2a2c2f550ac` — Purchase +3 pack, item `aeb1c8f2-391b-40f4-87f3-7ddea3ed723b`, 2026-09-17T13:42:46.331024+00:00; reference purchase_order `03fed49a-157f-4244-bb94-4bfebfed07eb`.
- `8b2115b6-e6fe-4ddc-9cf2-8917688baac2` — Purchase +6 pack, item `0f9920e9-8015-4e7c-8453-ef69bfa7ae77`, 2026-09-17T13:42:46.331024+00:00; reference purchase_order `03fed49a-157f-4244-bb94-4bfebfed07eb`.

Lifecycle request/audit evidence:

- `fdc01971-308b-4dc6-9ea4-5cb37e523905` — purchase_order, 2026-09-14T16:56:25.025754+00:00.
- `26f15cd7-b056-4aeb-8bd8-1b20a2c35730` — purchase_receipt, 2026-09-17T13:42:46.331024+00:00.

### HLIPH-260914-011

- PO ID: `1e20507c-a954-4e95-9646-c7ee41d3bc9a`; technical po_no: `PO-985071-370`.
- Created: 2026-09-14T16:56:25.159138+00:00; updated: 2026-09-17T13:41:34.105+00:00 (UTC).
- Status: completed; submitted: 2026-09-17T13:40:47.751+00:00; confirmed: 2026-09-17T13:40:49.031+00:00.
- Completed: 2026-09-17T13:41:34.105+00:00; completion type: full; unfulfilled quantity: 0; completion reason: —.
- Cancelled: No; cancellation reason: —.

| Item | Ordered | Received | UOM | Source line |
|---|---:|---:|---|---|
| Appalam / Papadam | 10 | 10 | pcs | c41487a9-cfee-4f86-923b-98cdb7d2c34e |
| Red Bean 红豆 | 3 | 3 | pack | 8a71e017-cb28-466e-b8b2-e1e399e0937c |
| Gula Melaka 椰糖 | 5 | 5 | pcs | 3b14598b-cf27-4c07-97e2-c6aa35731c9f |
| Maggi Seasoning | 1 | 1 | btl | d7eb2b2f-fbc7-4f9f-8f23-f62095ff1316 |
| Honey | 2 | 2 | btl | 3460d897-141c-4d8b-8ed9-7dbd35dc0674 |
| Oil - Cooking (BTL) | 12 | 12 | btl | 3cab3716-90ac-4e75-86b1-f4043fb51b16 |
| Cordyceps Flower 虫草花 | 1 | 1 | kg | c57fb417-6571-4965-acf7-0d126de44134 |
| Rice 10KG 黄金米 | 6 | 6 | pack | 81b09bfb-61e4-4aad-8a55-9c4528577b6a |
| Hup Loong Frying Powder 合隆炸粉 | 20 | 20 | pack | e20a872b-f7c2-4021-a264-3005695d3f0b |
| Oil - Cooking (PCK) | 2 | 2 | carton | c9bdb7f0-92c8-4553-8694-a6fabb96b878 |
| Barley 薏米 | 3 | 3 | pack | eb9df4a7-7543-4041-8678-d69bcc6110fe |
| Glass Noodle 红鸡冬粉 | 1 | 1 | carton | 54027ef5-9f60-4288-87be-e779a225a509 |

Receipts:

- `1999082d-3451-491a-8e5a-02da98bb78ef` at 2026-09-17T13:41:23.405091+00:00; 12 lines; quantities reconcile with PO received totals.

Inventory movements:

- `1ea56935-563a-484f-a5c9-de4292669f5b` — Purchase +10 pcs, item `85b7b71b-5ae1-4b2a-932a-7b7272a6d1cf`, 2026-09-17T13:41:23.405091+00:00; reference purchase_order `1e20507c-a954-4e95-9646-c7ee41d3bc9a`.
- `5e117a71-1ce0-48b2-b076-110e3bf2566c` — Purchase +3 pack, item `65004875-4061-4305-963b-5121f08422cd`, 2026-09-17T13:41:23.405091+00:00; reference purchase_order `1e20507c-a954-4e95-9646-c7ee41d3bc9a`.
- `0210df5c-e172-439d-b9b8-f1ade463e51e` — Purchase +1 kg, item `2183ef3b-d0f3-4106-b32d-a8a4788dc3b9`, 2026-09-17T13:41:23.405091+00:00; reference purchase_order `1e20507c-a954-4e95-9646-c7ee41d3bc9a`.
- `ec5230d9-bc98-4cba-bbab-c5c0ddebc715` — Purchase +1 carton, item `54f144c8-d5ab-4f96-81a6-c65504ccf831`, 2026-09-17T13:41:23.405091+00:00; reference purchase_order `1e20507c-a954-4e95-9646-c7ee41d3bc9a`.
- `adb30c7d-a43b-4bdc-aa3d-6afe1b5f492d` — Purchase +5 pcs, item `7a99d676-af05-4db6-93c8-9d91aa20def3`, 2026-09-17T13:41:23.405091+00:00; reference purchase_order `1e20507c-a954-4e95-9646-c7ee41d3bc9a`.
- `93d9cfd7-ce4b-4be1-9c65-0f5bb3f76cd6` — Purchase +2 btl, item `a795f26c-4540-4c4e-ab53-5ca2f2823fb8`, 2026-09-17T13:41:23.405091+00:00; reference purchase_order `1e20507c-a954-4e95-9646-c7ee41d3bc9a`.
- `41e59844-46ec-4467-95eb-659fac9ba1b1` — Purchase +20 pack, item `31acae1d-a325-4ee1-8fdd-87d45444638e`, 2026-09-17T13:41:23.405091+00:00; reference purchase_order `1e20507c-a954-4e95-9646-c7ee41d3bc9a`.
- `8cf2744d-01d0-47c5-9656-5335279c2309` — Purchase +1 btl, item `cd8917b0-1a54-4a2e-904e-a48c71ef13dc`, 2026-09-17T13:41:23.405091+00:00; reference purchase_order `1e20507c-a954-4e95-9646-c7ee41d3bc9a`.
- `12a34578-ce70-476c-a24d-73c213d586aa` — Purchase +12 btl, item `bacf2ec4-6aa5-476d-8c8b-4dac30221549`, 2026-09-17T13:41:23.405091+00:00; reference purchase_order `1e20507c-a954-4e95-9646-c7ee41d3bc9a`.
- `d7a58da1-f45b-47db-ac39-5c52e1802437` — Purchase +2 carton, item `b073ac1b-656c-4801-a8d1-04fa0396d14e`, 2026-09-17T13:41:23.405091+00:00; reference purchase_order `1e20507c-a954-4e95-9646-c7ee41d3bc9a`.
- `543ebc89-c1e3-4e9a-a986-87339931fafe` — Purchase +3 pack, item `aeb1c8f2-391b-40f4-87f3-7ddea3ed723b`, 2026-09-17T13:41:23.405091+00:00; reference purchase_order `1e20507c-a954-4e95-9646-c7ee41d3bc9a`.
- `28448b30-ccd9-4ca4-90f8-4f21e8f9c2cf` — Purchase +6 pack, item `0f9920e9-8015-4e7c-8453-ef69bfa7ae77`, 2026-09-17T13:41:23.405091+00:00; reference purchase_order `1e20507c-a954-4e95-9646-c7ee41d3bc9a`.

Lifecycle request/audit evidence:

- `a7d6f417-4fc7-424d-935b-10613f23b0f4` — purchase_order, 2026-09-14T16:56:25.159138+00:00.
- `2c8ea495-9371-47dc-99e5-ee4a58f08f9a` — purchase_receipt, 2026-09-17T13:41:23.405091+00:00.

## Bintang Utara Distribution

Supplier ID: `d61b819c-417a-435b-84ca-1ea101dae036`. Classification: **likely historical duplicate**. Exact line sets match; creation gap approximately 73ms.

### HLIPH-260914-012

- PO ID: `0fe2c5f5-994e-4257-872f-19b650d61c48`; technical po_no: `PO-985163-036`.
- Created: 2026-09-14T16:56:25.224502+00:00; updated: 2026-09-19T14:33:10.246+00:00 (UTC).
- Status: completed; submitted: 2026-09-17T13:46:49.393+00:00; confirmed: 2026-09-19T14:32:23.59+00:00.
- Completed: 2026-09-19T14:33:10.246+00:00; completion type: full; unfulfilled quantity: 0; completion reason: —.
- Cancelled: No; cancellation reason: —.

| Item | Ordered | Received | UOM | Source line |
|---|---:|---:|---|---|
| Planta  4.8kg | 2 | 2 | btl | f71ec440-5f31-434b-8780-eb1038189c61 |
| Swiss Bear Tatar | 1 | 1 | pack | 2c5bbefe-a810-4780-bf4d-8d881fa54e67 |
| Swiss Bear Coleslaw Dressing | 2 | 2 | pack | a8f32a6c-b3f3-4701-9eac-fa8023f43a52 |
| Kara Coconut Milk 1L | 12 | 12 | pack | da855569-951e-4807-acd2-1afe3d869404 |

Receipts:

- `7136d014-8e3a-4f02-8301-23a2604bbcf3` at 2026-09-19T14:32:39.856629+00:00; 4 lines; quantities reconcile with PO received totals.

Inventory movements:

- `d233de5b-477a-4700-bf41-4db1f8854355` — Purchase +12 pack, item `8877f5fe-022a-42dc-9a82-d3d0df9f82ce`, 2026-09-19T14:32:39.856629+00:00; reference purchase_order `0fe2c5f5-994e-4257-872f-19b650d61c48`.
- `8b3653dc-5bdf-4242-8530-7f55de29a05a` — Purchase +2 btl, item `4ab2d6e0-ab6c-440b-9e38-1b52c184e385`, 2026-09-19T14:32:39.856629+00:00; reference purchase_order `0fe2c5f5-994e-4257-872f-19b650d61c48`.
- `d673cca2-0160-4d4c-bbc9-4524f45bb3c9` — Purchase +2 pack, item `74dc18e9-46b5-4ea6-af6c-874257de3c72`, 2026-09-19T14:32:39.856629+00:00; reference purchase_order `0fe2c5f5-994e-4257-872f-19b650d61c48`.
- `1328ed1a-cf3f-4b6f-9915-3e40b8cd5e6f` — Purchase +1 pack, item `1d497c68-fe04-4f77-bdd7-f6d045dc690d`, 2026-09-19T14:32:39.856629+00:00; reference purchase_order `0fe2c5f5-994e-4257-872f-19b650d61c48`.

Lifecycle request/audit evidence:

- `bcb59da1-90be-4a64-8196-63c7fe9bb0c7` — purchase_order, 2026-09-14T16:56:25.224502+00:00.
- `a6c5020c-dac4-43a5-aaf7-eccda27edebc` — purchase_receipt, 2026-09-19T14:32:39.856629+00:00.

### HLIPH-260914-015

- PO ID: `63a021cb-b6a0-4a58-83d0-5ed37644b391`; technical po_no: `PO-985260-036`.
- Created: 2026-09-14T16:56:25.297191+00:00; updated: 2026-09-17T13:40:04.009+00:00 (UTC).
- Status: completed; submitted: 2026-09-17T13:39:28.271+00:00; confirmed: 2026-09-17T13:39:30.171+00:00.
- Completed: 2026-09-17T13:40:04.009+00:00; completion type: full; unfulfilled quantity: 0; completion reason: —.
- Cancelled: No; cancellation reason: —.

| Item | Ordered | Received | UOM | Source line |
|---|---:|---:|---|---|
| Swiss Bear Coleslaw Dressing | 2 | 2 | pack | a8f32a6c-b3f3-4701-9eac-fa8023f43a52 |
| Swiss Bear Tatar | 1 | 1 | pack | 2c5bbefe-a810-4780-bf4d-8d881fa54e67 |
| Kara Coconut Milk 1L | 12 | 12 | pack | da855569-951e-4807-acd2-1afe3d869404 |
| Planta  4.8kg | 2 | 2 | btl | f71ec440-5f31-434b-8780-eb1038189c61 |

Receipts:

- `16b1c8e6-a929-407e-9afa-22fc839f90f6` at 2026-09-17T13:39:50.630463+00:00; 4 lines; quantities reconcile with PO received totals.

Inventory movements:

- `d4de578e-1ddf-4e08-ab56-afdb2aea428e` — Purchase +12 pack, item `8877f5fe-022a-42dc-9a82-d3d0df9f82ce`, 2026-09-17T13:39:50.630463+00:00; reference purchase_order `63a021cb-b6a0-4a58-83d0-5ed37644b391`.
- `03d21b44-2479-4ed8-bfde-41366c75547f` — Purchase +2 btl, item `4ab2d6e0-ab6c-440b-9e38-1b52c184e385`, 2026-09-17T13:39:50.630463+00:00; reference purchase_order `63a021cb-b6a0-4a58-83d0-5ed37644b391`.
- `62029a9c-f2e6-4621-88d0-2571daa75636` — Purchase +2 pack, item `74dc18e9-46b5-4ea6-af6c-874257de3c72`, 2026-09-17T13:39:50.630463+00:00; reference purchase_order `63a021cb-b6a0-4a58-83d0-5ed37644b391`.
- `5e751736-9d84-4797-ba4a-98874263a668` — Purchase +1 pack, item `1d497c68-fe04-4f77-bdd7-f6d045dc690d`, 2026-09-17T13:39:50.630463+00:00; reference purchase_order `63a021cb-b6a0-4a58-83d0-5ed37644b391`.

Lifecycle request/audit evidence:

- `e5e545b6-07a7-4a26-a388-64bbed77218f` — purchase_order, 2026-09-14T16:56:25.297191+00:00.
- `777abdf0-b798-404e-ad59-95111df9d77b` — purchase_receipt, 2026-09-17T13:39:50.630463+00:00.

## Dependencies and root cause

- 14 distinct purchase_order request result snapshots plus eight purchase_receipt request results reference these POs. Preserve all 22.
- No audit_logs rows matched PO UUIDs, technical PO numbers, or source UUID in metadata/description. This is scoped lookup absence, not proof of no external audit history.
- PO items and receipt headers have ON DELETE CASCADE references to POs; receipt items cascade from receipts. Deletion would destroy dependent facts. Inventory movements and lifecycle JSON references are logical dependencies, not cascaded PO FKs.
- Production's only PO unique index is its UUID primary key; no source uniqueness trigger exists.
- Live inventory_save_purchase_order serializes/replays by request ID only. It does not serialize/check the source/supplier pair. Distinct request IDs therefore legitimately pass its old request-idempotency guard and can create identical orders. Database evidence supports this failure mode; no browser/network trace survives to attribute double-click versus concurrent invocations.
- Pending foundation adds source-level advisory locking, source/supplier and source-item checks, request fingerprints, authorized wrappers and client DML revocation. Preserve all of those; they are not compatibility cleanup targets.

## Intended invariant

For source_type=stock_check, at most one **non-cancelled** PO per source_stock_check_id + supplier_id. Completed counts as non-cancelled: successful receiving must never reopen the source for duplicate ordering. Replacement becomes eligible only when no non-cancelled order remains. Manual POs are outside this key. Source-item uniqueness is a separate existing canonical validation and remains intact.

The proposed global partial unique index cannot build over these historical pairs. A timestamp-only index is insufficient: it does not prevent a new order conflicting with historical orders, and client-controlled/backdated timestamps must not evade it.

## Recommended smallest non-destructive design (NOT implemented)

Use a private **source/supplier reservation** relation in inventory_authority, unique on the same source/supplier key, as the database uniqueness backstop instead of a global unique index over historical PO rows.

1. In one locked migration transaction, reserve each distinct existing non-cancelled key. Preserve the complete existing PO membership for legacy conflict evidence; select no winning PO. This writes compatibility metadata only, not PO business records.
2. A database-owned insert/key-change/reactivation guard atomically acquires that key for a new non-cancelled source PO. A unique conflict rejects creation even when the reserved key belongs to historical records.
3. Existing same-key lifecycle progress remains allowed. Cancellation only releases a reservation after **all** non-cancelled POs for that key are gone. Completed POs retain reservations. Cancel one legacy sibling must never release the other sibling's reservation.
4. Serialize reservation changes consistently with the current source lock. Use transaction-safe unique-key locking for privileged/direct writes too; no application-only bypass, arbitrary timestamp exemption, or new client grant.
5. Keep request replay/fingerprint/source-item rules unchanged. Preserve reservation/audit provenance and prohibit client editing of compatibility metadata.
6. Rehearse existing historical lifecycle continuation, new-vs-historical rejection, concurrent new-vs-new, cancellation with sibling, all-cancelled replacement, request replay and rollback. Include the actual historical shape in local replay; no Production mutations.
7. A protected grandfather marker + partial index is an alternative only with a full-history database guard. It requires technical updates on historical PO rows and offers no advantage here; the reservation design avoids those updates entirely.

Approval is required for this compatibility schema/authority replacement and preservation policy. No implementation or migration file was changed in this task.

## Shared Filter Bar authenticated visual closure

Canonical Staging: 881ffdb3c66271ce3e3a15878b92b3fa25bcb1fd, includes e599fa6c. Authenticated Admin owner browser. Actual CSS viewport widths measured from DOM: **1440 and 1024** (initial Roles additional check 1800).

| Page | Desktop / narrow toolbar width | Search / select behavior | Outcome |
|---|---|---|---|
| Roles | 1159 / 986.25 px | Single search fills available inner width; accounts search returns one role | PASS |
| Departments | 1159 / 986.25 px | Search 933 / 760; Status 180; Inactive yields empty table, cleared back to All | PASS |
| Legal Entities | 1159 / 986.25 px | Same two-field grammar; ABC search returns one entity, cleared | PASS |
| Employees | 1159 / 986.25 px | Search 348 / 370; selects 180; clean 5+1 / 4+2 wrapping; CCC search returns one employee, cleared | PASS |
| Par Levels | 1159 / 986.25 px | Outlet 230, search 493 / 320, Category/Group By 180; required Friends Corner preserved | PASS |

Toolbar widths equal their available content parent widths. documentElement.scrollWidth equals innerWidth at each measured width. Screenshots inspected for each page/width. No overlapping fields or clipped toolbar content found. Dense tables retain their existing responsive behavior, not changed by this task.

Par Levels Saved status and Outlet View / Matrix View tablist share the content-header action owner, not Filters. Cendol search yielded one matrix item; Matrix/Outlet switch worked and original Outlet View, Friends Corner, empty search were restored. No par quantity/storage/supplier inputs were edited. Autosave was not retested by mutation; existing behavior retained. Browser error logs returned [] for this focused pass.

## Release impact

- Batch A existing candidate: 6da4f6ca868689d38ecd1f8e62188a1ced48dc4f. Retain its scoped application patch, but **a new isolated candidate SHA** is required with the reviewed compatibility migration replacing the unapplied blocking index. Do not deploy the existing candidate unchanged or exclude the invariant while retaining related PO changes.
- Already-applied Staging migration history must not be rewritten. Design a forward reconciliation for Staging separately from the corrected, not-yet-applied Production release manifest, with explicit hash/version handling. Rehearse both paths.
- Payroll standalone candidate: c3d49099fa8d0f9b29762c021d02a3a57c460b2a remains READY independently. Cumulative candidate b78d242e must inherit the new A compatibility change before combined release; no Payroll re-QA is necessary unless that changes Payroll ownership.
- Restaurant release is NOT READY until compatibility approval, focused implementation/concurrency proof, fresh migration rehearsal and candidate manifest update. Visual blocker is closed. No Production deployment authorization is inferred.

Documentation Impact: None — evidence-only audit/visual closure, no durable implementation or authority change. This release report records the proposed, unapproved design.

