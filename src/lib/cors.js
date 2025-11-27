function cors(options = {}) {
  const allowOrigin = options.origin === true ? null : options.origin;
  const allowCredentials = options.credentials;

  return (req, res, next) => {
    const origin = allowOrigin === null ? req.headers.origin || '*' : allowOrigin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    if (allowCredentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    const requestHeaders = req.headers['access-control-request-headers'];
    const requestMethod = req.headers['access-control-request-method'];
    if (requestHeaders) {
      res.setHeader('Access-Control-Allow-Headers', requestHeaders);
    }
    if (requestMethod) {
      res.setHeader('Access-Control-Allow-Methods', requestMethod);
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    next();
  };
}

module.exports = cors;
