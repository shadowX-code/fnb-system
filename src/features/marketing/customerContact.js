export const contactState = customer => customer.contact_state || (customer.suppressed || customer.consent?.decision === 'withdrawn' ? 'do_not_contact' : customer.eligible ? 'subscribed' : 'not_subscribed');
export const contactLabel = customer => ({subscribed:'Subscribed',not_subscribed:'Not Subscribed',do_not_contact:'Do Not Contact'})[contactState(customer)];
