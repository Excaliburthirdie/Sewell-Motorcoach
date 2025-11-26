const { loadData, saveData } = require('../persistence/store');

const datasets = {
  inventory: loadData('inventory.json', []),
  teams: loadData('teams.json', []),
  reviews: loadData('reviews.json', []),
  leads: loadData('leads.json', []),
  capabilities: loadData('capabilities.json', []),
  settings: loadData('settings.json', {
    dealershipName: 'Sewell Motorcoach',
    address: '2118 Danville Rd',
    city: 'Harrodsburg',
    state: 'KY',
    zip: '40330',
    country: 'USA',
    currency: 'USD',
    phone: '859-734-5566',
    email: 'sales@sewellmotorcoach.com',
    hours: {
      weekday: '9:00 AM - 6:00 PM',
      saturday: '10:00 AM - 4:00 PM',
      sunday: 'Closed'
    }
  }),
  customers: loadData('customers.json', []),
  serviceTickets: loadData('serviceTickets.json', []),
  financeOffers: loadData('financeOffers.json', [])
};

const persist = {
  inventory: data => saveData('inventory.json', data),
  teams: data => saveData('teams.json', data),
  reviews: data => saveData('reviews.json', data),
  leads: data => saveData('leads.json', data),
  capabilities: data => saveData('capabilities.json', data),
  settings: data => saveData('settings.json', data),
  customers: data => saveData('customers.json', data),
  serviceTickets: data => saveData('serviceTickets.json', data),
  financeOffers: data => saveData('financeOffers.json', data)
};

module.exports = {
  datasets,
  persist
};
