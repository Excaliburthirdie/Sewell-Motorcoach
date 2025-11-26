class AppError extends Error {
  constructor(code, message, statusCode = 500, details) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const response = {
    error: {
      code,
      message: err.message || 'Unexpected error',
      requestId: req.requestId
    }
  };

  if (err.details) {
    response.error.details = err.details;
  }

  console.error(
    JSON.stringify({
      level: 'error',
      requestId: req.requestId,
      code,
      statusCode,
      message: err.message,
      stack: err.stack
    })
  );

  res.status(statusCode).json(response);
}

module.exports = {
  AppError,
  errorHandler
};
