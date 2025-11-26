const { datasets, persist } = require('./state');
const { validateFields } = require('./shared');

function get() {
  return datasets.settings;
}

function update(payload) {
  const requiredError = validateFields(payload, ['dealershipName', 'phone']);
  if (requiredError) {
    return { error: requiredError };
  }

  const hours = payload.hours || datasets.settings.hours;
  datasets.settings = {
    ...datasets.settings,
    ...payload,
    hours: {
      ...datasets.settings.hours,
      ...hours
    }
  };
  persist.settings(datasets.settings);
  return { settings: datasets.settings };
}

module.exports = {
  get,
  update
};
