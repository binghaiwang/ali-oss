
const crypto = require('crypto');
const is = require('is-type-of');

/**
 *
 * @param {String} resourcePath
 * @param {Object} parameters
 * @return
 */
exports.buildCanonicalizedResource = function buildCanonicalizedResource(resourcePath, parameters) {
  let canonicalizedResource = `${resourcePath}`;
  let separatorString = '?';

  if (is.string(parameters) && parameters.trim() !== '') {
    canonicalizedResource += separatorString + parameters;
  } else if (is.array(parameters)) {
    parameters.sort();
    canonicalizedResource += separatorString + parameters.join('&');
  } else if (parameters) {
    const compareFunc = (entry1, entry2) => {
      if (entry1[0] >= entry2[0]) {
        return 1;
      }
      return 0;
    };
    const processFunc = (key) => {
      canonicalizedResource += separatorString + key;
      if (parameters[key]) {
        canonicalizedResource += `=${parameters[key]}`;
      }
      separatorString = '&';
    };
    Object.keys(parameters).sort(compareFunc).forEach(processFunc);
  }

  return canonicalizedResource;
};

/**
 * @param {String} method
 * @param {String} resourcePath
 * @param {Object} request
 * @param {String} expires
 * @return {String} canonicalString
 */
exports.buildCanonicalString = function canonicalString(method, resourcePath, request, expires) {
  request = request || {};
  const headers = request.headers || {};
  const OSS_PREFIX = 'x-oss-';
  const ossHeaders = [];
  const headersToSign = {};

  let signContent = [
    method.toUpperCase(),
    headers['Content-Md5'] || '',
    headers['Content-Type'] || headers['Content-Type'.toLowerCase()],
    expires || headers['x-oss-date'],
  ];

  Object.keys(headers).forEach((key) => {
    const lowerKey = key.toLowerCase();
    if (lowerKey.indexOf(OSS_PREFIX) === 0) {
      headersToSign[lowerKey] = String(headers[key]).trim();
    }
  });

  Object.keys(headersToSign).sort().forEach((key) => {
    ossHeaders.push(`${key}:${headersToSign[key]}`);
  });

  signContent = signContent.concat(ossHeaders);

  signContent.push(this.buildCanonicalizedResource(resourcePath, request.parameters));

  return signContent.join('\n');
};

/**
 * @param {String} accessKeySecret
 * @param {String} canonicalString
 */
exports.computeSignature = function computeSignature(accessKeySecret, canonicalString) {
  const signature = crypto.createHmac('sha1', accessKeySecret);
  return signature.update(new Buffer(canonicalString, 'utf8')).digest('base64');
};

/**
 * @param {String} accessKeyId
 * @param {String} accessKeySecret
 * @param {String} canonicalString
 */
exports.authorization = function authorization(accessKeyId, accessKeySecret, canonicalString) {
  return `OSS ${accessKeyId}:${this.computeSignature(accessKeySecret, canonicalString)}`;
};

/**
 *
 * @param {String} accessKeySecret
 * @param {Object} options
 * @param {String} resource
 * @param {Number} expires
 */
exports._signatureForURL = function _signatureForURL(accessKeySecret, options, resource, expires) {
  const headers = {};
  const subResource = {};

  if (options.process) {
    const processKeyword = 'x-oss-process';
    subResource[processKeyword] = options.process;
  }

  if (options.response) {
    Object.keys(options.response).forEach((k) => {
      const key = `response-${k.toLowerCase()}`;
      subResource[key] = options.response[key];
    });
  }

  Object.keys(options).forEach((key) => {
    const lowerKey = key.toLowerCase();
    const value = options[key];
    if (lowerKey.indexOf('x-oss-') === 0) {
      headers[lowerKey] = value;
    } else if (lowerKey !== 'expires' && lowerKey !== 'response' && lowerKey !== 'process' && lowerKey !== 'method') {
      subResource[lowerKey] = value;
    }
  });

  if (Object.prototype.hasOwnProperty.call(options, 'security-token')) {
    subResource['security-token'] = options['security-token'];
  }

  if (Object.prototype.hasOwnProperty.call(options, 'callback')) {
    const json = {
      callbackUrl: encodeURI(options.callback.url),
      callbackBody: options.callback.body,
    };
    if (options.callback.host) {
      json.callbackHost = options.callback.host;
    }
    if (options.callback.contentType) {
      json.callbackBodyType = options.callback.contentType;
    }
    subResource.callback = new Buffer(JSON.stringify(json)).toString('base64');

    if (options.callback.customValue) {
      const callbackVar = {};
      Object.keys(options.callback.customValue).forEach((key) => {
        callbackVar[`x:${key}`] = options.callback.customValue[key];
      });
      subResource['callback-var'] = new Buffer(JSON.stringify(callbackVar)).toString('base64');
    }
  }

  const canonicalString = this.buildCanonicalString(options.method, resource, {
    headers,
    parameters: subResource,
  }, expires.toString());

  return {
    Signature: this.computeSignature(accessKeySecret, canonicalString),
    subResource,
  };
};
