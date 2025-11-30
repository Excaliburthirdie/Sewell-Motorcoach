const aiRegistryService = require('./aiRegistryService');

function listTools(options = {}) {
  return aiRegistryService.listTools(options);
}

function getToolByName(name, options = {}) {
  const tools = listTools(options);
  return tools.find(tool => tool.name === name);
}

module.exports = {
  listTools,
  getToolByName
};
