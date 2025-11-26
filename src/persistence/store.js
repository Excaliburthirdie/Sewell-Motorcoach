const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');

function loadData(file, defaultValue) {
  try {
    const data = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return defaultValue;
  }
}

function saveData(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

module.exports = {
  DATA_DIR,
  loadData,
  saveData
};
