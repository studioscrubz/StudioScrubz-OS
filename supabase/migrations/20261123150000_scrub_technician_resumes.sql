alter table public.job_applications
 add column has_resume boolean not null default false,
 add constraint job_applications_resume_opening_check
 check (not has_resume or opening_identifier = 'scrub-tech');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-application-resumes', 'job-application-resumes', false, 3145728, array['application/pdf']);
