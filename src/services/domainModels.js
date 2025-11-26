/**
 * Domain models for the RV dealership backend. These are plain objects that
 * outline the attributes stored for each resource and can evolve over time
 * without coupling them to Express routing concerns.
 */

const customerModel = {
  id: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  preferredContactMethod: 'email',
  marketingOptIn: false,
  notes: ''
};

const serviceTicketModel = {
  id: '',
  customerId: '',
  unitId: '',
  status: 'open',
  concern: '',
  scheduledDate: null,
  technician: '',
  warranty: false,
  lineItems: []
};

const financeOfferModel = {
  id: '',
  lender: '',
  termMonths: 0,
  apr: 0,
  downPayment: 0,
  restrictions: '',
  vehicleCategory: 'Motorhome'
};

module.exports = {
  customerModel,
  serviceTicketModel,
  financeOfferModel
};
