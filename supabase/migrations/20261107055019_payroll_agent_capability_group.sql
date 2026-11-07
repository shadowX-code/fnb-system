-- The shared Agent selector groups both View and actions by navigation section.
update feedx_integrations.navigation_modules
set section='Payroll Preparation'
where workspace='HR' and id='payroll';
