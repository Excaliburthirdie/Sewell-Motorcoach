const http = require('http');
const { parse: parseUrl } = require('url');
const fs = require('fs');
const path = require('path');

function compilePath(pattern) {
  const keys = [];
  const escaped = pattern
    .replace(/\//g, '\\/')
    .replace(/:(\w+)/g, (_m, key) => {
      keys.push(key);
      return '([^/]+)';
    });
  const regex = new RegExp(`^${escaped}$`);
  return { regex, keys };
}

function createResponseHelpers(res) {
  res.status = code => {
    res.statusCode = code;
    return res;
  };

  res.set = (field, value) => {
    if (typeof field === 'object') {
      Object.entries(field).forEach(([key, val]) => res.setHeader(key, val));
    } else {
      res.setHeader(field, value);
    }
    return res;
  };

  res.type = value => {
    res.setHeader('Content-Type', value);
    return res;
  };

  res.json = payload => {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify(payload));
  };

  res.send = payload => {
    if (payload === undefined || payload === null) {
      return res.end();
    }

    if (Buffer.isBuffer(payload)) {
      return res.end(payload);
    }

    if (typeof payload === 'object') {
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json');
      }
      return res.end(JSON.stringify(payload));
    }

    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'text/plain');
    }
    return res.end(String(payload));
  };

  res.cookie = (name, value, options = {}) => {
    const attributes = [`${name}=${encodeURIComponent(value)}`];
    if (options.maxAge !== undefined) attributes.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
    if (options.domain) attributes.push(`Domain=${options.domain}`);
    if (options.path) attributes.push(`Path=${options.path}`);
    if (options.httpOnly) attributes.push('HttpOnly');
    if (options.secure) attributes.push('Secure');
    if (options.sameSite) attributes.push(`SameSite=${options.sameSite}`);
    const existing = res.getHeader('Set-Cookie');
    const valueToSet = existing ? [].concat(existing, attributes.join('; ')) : attributes.join('; ');
    res.setHeader('Set-Cookie', valueToSet);
    return res;
  };

  res.sendFile = filePath => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      res.statusCode = 404;
      res.end();
    });
    stream.pipe(res);
  };
}

function buildStaticMiddleware(root) {
  return (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    const targetPath = path.resolve(root, '.' + decodeURIComponent(req.path));
    if (!targetPath.startsWith(path.resolve(root))) return next();
    fs.stat(targetPath, (err, stats) => {
      if (err || !stats.isFile()) return next();
      fs.createReadStream(targetPath).pipe(res);
    });
  };
}

function parseBody(limitBytes, parser) {
  return (req, _res, next) => {
    if (req._bodyParsed) return next();
    const contentType = req.headers['content-type'] || '';
    if (!parser.matches(contentType)) return next();

    let length = 0;
    const chunks = [];
    req.on('data', chunk => {
      length += chunk.length;
      if (length > limitBytes) {
        req.destroy();
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      req._bodyParsed = true;
      const raw = Buffer.concat(chunks).toString(parser.encoding);
      try {
        req.body = parser.parse(raw);
        next();
      } catch (err) {
        next(err);
      }
    });
  };
}

function jsonParser({ limit }) {
  const limitBytes = parseLimit(limit);
  return parseBody(limitBytes, {
    encoding: 'utf8',
    matches: type => type.includes('application/json'),
    parse: raw => (raw ? JSON.parse(raw) : {})
  });
}

function urlencodedParser({ limit }) {
  const limitBytes = parseLimit(limit);
  return parseBody(limitBytes, {
    encoding: 'utf8',
    matches: type => type.includes('application/x-www-form-urlencoded'),
    parse: raw => {
      const params = new URLSearchParams(raw);
      const result = {};
      for (const [key, value] of params.entries()) {
        if (result[key]) {
          result[key] = [].concat(result[key], value);
        } else {
          result[key] = value;
        }
      }
      return result;
    }
  });
}

function parseLimit(limit) {
  if (typeof limit === 'number') return limit;
  if (typeof limit === 'string' && limit.toLowerCase().endsWith('mb')) {
    const mb = Number(limit.slice(0, -2));
    return mb * 1024 * 1024;
  }
  return 1024 * 1024;
}

function createApp() {
  const middlewares = [];
  const routes = [];
  const settings = {};

  const app = function handle(req, res, out) {
    const parsedUrl = parseUrl(req.url, true);
    req.path = parsedUrl.pathname || '/';
    req.query = parsedUrl.query || {};
    req.params = {};
    req.originalUrl = req.originalUrl || req.url;
    req.ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
    req.body = req.body || {};

    createResponseHelpers(res);

    const stack = buildStack(req);
    let idx = 0;

    function next(err) {
      const layer = stack[idx++];
      if (!layer) {
        if (out) return out(err);
        if (err) {
          res.statusCode = res.statusCode || 500;
          res.end(err.message || 'Server error');
        } else if (!res.writableEnded) {
          res.statusCode = res.statusCode || 404;
          res.end('Not Found');
        }
        return;
      }

      const handler = layer.handler;
      const isErrorHandler = layer.errorHandler;
      if (err && !isErrorHandler) return next(err);
      if (!err && isErrorHandler) return next();

      try {
        if (handler.length >= 4) {
          handler(err, req, res, next);
        } else {
          handler(req, res, next);
        }
      } catch (e) {
        next(e);
      }
    }

    next();
  };

  function buildStack(req) {
    const stack = [];
    const pathName = req.path;

    middlewares.forEach(layer => {
      if (layer.path && !pathName.startsWith(layer.path)) return;
      if (layer.router) {
        stack.push({
          handler: (req, res, next) => {
            const originalUrl = req.url;
            const originalPath = req.path;
            req.url = req.url.slice(layer.path.length) || '/';
            req.path = req.path.slice(layer.path.length) || '/';
            layer.router(req, res, err => {
              req.url = originalUrl;
              req.path = originalPath;
              next(err);
            });
          }
        });
      } else {
        stack.push({ handler: layer.handler, errorHandler: layer.errorHandler });
      }
    });

    routes.forEach(route => {
      if (route.method !== req.method) return;
      const match = route.matcher.regex.exec(pathName);
      if (!match) return;
      route.keys.forEach((key, idx) => {
        req.params[key] = match[idx + 1];
      });
      req.route = { path: route.path };
      route.handlers.forEach(handler => stack.push({ handler }));
    });

    return stack;
  }

  function addMiddleware(pathOrHandler, maybeHandler) {
    const layer = { path: '/', handler: null, router: null, errorHandler: false };
    if (typeof pathOrHandler === 'string') {
      layer.path = pathOrHandler.endsWith('/') ? pathOrHandler.slice(0, -1) || '/' : pathOrHandler;
      layer.handler = maybeHandler;
    } else {
      layer.handler = pathOrHandler;
    }

    if (layer.handler && layer.handler._isRouter) {
      layer.router = layer.handler;
    }
    layer.errorHandler = typeof layer.handler === 'function' && layer.handler.length === 4;
    middlewares.push(layer);
  }

  function addRoute(method) {
    return (routePath, ...handlers) => {
      const paths = Array.isArray(routePath) ? routePath : [routePath];
      paths.forEach(pathEntry => {
        const normalized = pathEntry.endsWith('/') && pathEntry !== '/' ? pathEntry.slice(0, -1) : pathEntry;
        const matcher = compilePath(normalized);
        routes.push({ method: method.toUpperCase(), path: normalized, matcher, handlers, keys: matcher.keys });
      });
    };
  }

  app.use = addMiddleware;
  app.get = addRoute('GET');
  app.post = addRoute('POST');
  app.put = addRoute('PUT');
  app.delete = addRoute('DELETE');
  app.patch = addRoute('PATCH');

  app.set = (key, value) => {
    settings[key] = value;
  };

  app.disable = key => {
    settings[key] = false;
  };

  app.listen = (port, cb) => {
    const server = http.createServer(app);
    return server.listen(port, cb);
  };

  return app;
}

function Router() {
  const router = createApp();
  router._isRouter = true;
  return router;
}

module.exports = Object.assign(createApp, {
  Router,
  json: jsonParser,
  urlencoded: urlencodedParser,
  static: buildStaticMiddleware
});
