const { ZodError } = require('../validation/zodLite');
const { AppError } = require('./errors');

function formatZodIssues(error) {
  return error.issues.map(issue => ({
    path: issue.path.join('.'),
    message: issue.message
  }));
}

function buildValidator(schema, property) {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req[property]);
      req.validated = req.validated || {};
      req.validated[property] = parsed;
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(new AppError('VALIDATION_FAILED', 'Request validation failed', 400, formatZodIssues(err)));
      }
      return next(err);
    }
  };
}

const validateBody = schema => buildValidator(schema, 'body');
const validateQuery = schema => buildValidator(schema, 'query');
const validateParams = schema => buildValidator(schema, 'params');

module.exports = {
  validateBody,
  validateParams,
  validateQuery
};
