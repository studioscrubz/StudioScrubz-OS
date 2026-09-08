-- Approved residential links only; existing records, pricing and other links stay unchanged.
begin;

insert into public.service_addon_links (service_id, addon_id) values
  ('c31ea15e-28d8-4675-87b9-1a6278104d3e', '40703776-eda0-4068-a936-06b85f2b6e7d'),
  ('c31ea15e-28d8-4675-87b9-1a6278104d3e', '5213462e-1999-4cb5-b9c5-249b8d31fd02'),
  ('c31ea15e-28d8-4675-87b9-1a6278104d3e', 'aeb7742e-164c-4877-ad4f-db0e5d95a157'),
  ('c31ea15e-28d8-4675-87b9-1a6278104d3e', '276c240e-9b80-486c-9b88-5faed3f51970'),
  ('c31ea15e-28d8-4675-87b9-1a6278104d3e', '0cd20b49-e1f6-44d9-a1fc-ce87ee248312'),
  ('c31ea15e-28d8-4675-87b9-1a6278104d3e', '1c4ca626-6b57-4c7d-a185-5946e781d1c6'),
  ('c31ea15e-28d8-4675-87b9-1a6278104d3e', '6b7c1cfd-7677-49fc-83c3-56f46838baed'),
  ('c31ea15e-28d8-4675-87b9-1a6278104d3e', '529af457-7070-4655-9e0c-a3ed33a34f35'),
  ('c31ea15e-28d8-4675-87b9-1a6278104d3e', '5a1a8100-b67e-4676-b581-d9f4f76a93d3'),
  ('eeeb3ebe-f9ab-42e4-a260-fb3b64cfab42', '40703776-eda0-4068-a936-06b85f2b6e7d'),
  ('eeeb3ebe-f9ab-42e4-a260-fb3b64cfab42', '5213462e-1999-4cb5-b9c5-249b8d31fd02'),
  ('eeeb3ebe-f9ab-42e4-a260-fb3b64cfab42', 'aeb7742e-164c-4877-ad4f-db0e5d95a157'),
  ('eeeb3ebe-f9ab-42e4-a260-fb3b64cfab42', '276c240e-9b80-486c-9b88-5faed3f51970'),
  ('eeeb3ebe-f9ab-42e4-a260-fb3b64cfab42', '0cd20b49-e1f6-44d9-a1fc-ce87ee248312'),
  ('eeeb3ebe-f9ab-42e4-a260-fb3b64cfab42', '1c4ca626-6b57-4c7d-a185-5946e781d1c6'),
  ('eeeb3ebe-f9ab-42e4-a260-fb3b64cfab42', '6b7c1cfd-7677-49fc-83c3-56f46838baed'),
  ('eeeb3ebe-f9ab-42e4-a260-fb3b64cfab42', '529af457-7070-4655-9e0c-a3ed33a34f35'),
  ('eeeb3ebe-f9ab-42e4-a260-fb3b64cfab42', '5a1a8100-b67e-4676-b581-d9f4f76a93d3'),
  ('6df3eaa3-7cea-4315-9b1d-842295c89e76', '5213462e-1999-4cb5-b9c5-249b8d31fd02'),
  ('6df3eaa3-7cea-4315-9b1d-842295c89e76', '1c4ca626-6b57-4c7d-a185-5946e781d1c6'),
  ('6df3eaa3-7cea-4315-9b1d-842295c89e76', '529af457-7070-4655-9e0c-a3ed33a34f35'),
  ('6df3eaa3-7cea-4315-9b1d-842295c89e76', '5a1a8100-b67e-4676-b581-d9f4f76a93d3'),
  ('29699f24-92d7-4296-bc4b-7d21521c3904', '40703776-eda0-4068-a936-06b85f2b6e7d'),
  ('29699f24-92d7-4296-bc4b-7d21521c3904', '276c240e-9b80-486c-9b88-5faed3f51970'),
  ('29699f24-92d7-4296-bc4b-7d21521c3904', '0cd20b49-e1f6-44d9-a1fc-ce87ee248312'),
  ('29699f24-92d7-4296-bc4b-7d21521c3904', '6b7c1cfd-7677-49fc-83c3-56f46838baed')
on conflict (service_id, addon_id) do nothing;

commit;
