/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var Hoek = require('hapi').utils;
var Boom = require('hapi').error

var DEFAULTS = {
  message: 'Unspecified error',
  info: 'https://github.com/mozilla/fxa-auth-server/blob/master/docs/api.md#response-format'
}

var TOO_LARGE = /^Payload (?:content length|size) greater than maximum allowed/

module.exports = function(log) {

  // Make a copy of Boom onto which we'll add our own customizations.
  var errors = {}
  Object.keys(Boom).forEach(function(key) {
    errors[key] = Boom[key]
  })

  // Wrap an object into a Boom error response.
  //
  // If the object does not have an 'errno' attribute, this function
  // tries to intuit the appropriate details of the error.  It's ugly
  // but it's better than monkey-patching e.g. the Hawk auth lib to
  // send errors in the desired format.
  //
  // If the object does not have a 'code' attribute, this function determines
  // the appropriate HTTP status code based on its 'errno' attribute.

  errors.wrap = function (srcObject) {
    // Merge object properties with defaults.
    // The source object might be an Error instance whose 'message' property
    // is non-enumerable, so we have to special-case that one.
    var object = Hoek.applyToDefaults(DEFAULTS, srcObject)
    if (srcObject.hasOwnProperty('message')) {
      object.message = srcObject.message
    }

    // Intuit an errno for the error, if it doesn't have one.
    if (typeof object.errno === 'undefined') {
      if (object.code === 401) {
        // These are common errors generated by Hawk auth lib.
        if (object.message === 'Unknown credentials') {
          object = errors.invalidToken().response.payload
        } else if (object.message === 'Invalid credentials') {
          object = errors.invalidToken().response.payload
        } else if (object.message === 'Stale timestamp') {
          object = errors.invalidTimestamp().response.payload
        } else if (object.message === 'Invalid nonce') {
          object = errors.invalidNonce().response.payload
        } else {
          object = errors.invalidSignature(object.message).response.payload
        }
      }
      else if (object.code === 400) {
        if (TOO_LARGE.test(object.message)) {
          object = errors.requestBodyTooLarge().response.payload
        }
      }
    }

    // Intuit a status code for the error if it doesn't have one,
    // or if it has some other garbage in its 'code' attribute.
    if (typeof object.code === 'undefined') {
      if ([109, 110, 111].indexOf(object.errno) !== -1) {
        object.code = 401
      } else {
        object.code = 400
      }
    } else if (typeof object.code !== 'number') {
      object.code = 500
    }

    // If we weren't able to identify a specific type of error,
    // default to a generic "unspecified error" response.
    if (typeof object.errno === 'undefined') {
      log.error({ op: 'error.wrap', msg: 'unexpected error', err: object })
      object.errno = 999;
    }

    // Now we can safely boomify it.
    var b = new Boom(object.code, object.message)
    Hoek.merge(b.response.payload, object);
    return b
  }


  // Helper functions for creating particular response types.

  errors.accountExists = function (email) {
    return errors.wrap({
      code: 400,
      errno: 101,
      message: 'Account already exists',
      email: email
    })
  }

  errors.unknownAccount = function (email) {
    return errors.wrap({
      code: 400,
      errno: 102,
      message: 'Unknown account',
      email: email
    })
  }

  errors.incorrectPassword = function (email) {
    return errors.wrap({
      code: 400,
      errno: 103,
      message: 'Incorrect password',
      email: email
    })
  }

  errors.unverifiedAccount = function () {
    return errors.wrap({
      code: 400,
      errno: 104,
      message: 'Unverified account'
    })
  }

  errors.invalidVerificationCode = function (details) {
    return errors.wrap(Hoek.merge({
      code: 400,
      errno: 105,
      message: 'Invalid verification code'
    }, details));
  }

  errors.invalidRequestBody = function () {
    return errors.wrap({
      code: 400,
      errno: 106,
      message: 'Invalid JSON in request body'
    })
  }

  errors.invalidRequestParameter = function (param) {
    return errors.wrap({
      code: 400,
      errno: 107,
      message: 'Invalid parameter in request body' + (param ? ': ' + param : ''),
      param: param
    })
  }

  errors.missingRequestParameter = function (param) {
    return errors.wrap({
      code: 400,
      errno: 108,
      message: 'Missing parameter in request body' + (param ? ': ' + param : ''),
      param: param
    })
  }

  errors.invalidSignature = function (message) {
    return errors.wrap({
      code: 401,
      errno: 109,
      message: message || 'Invalid request signature'
    })
  }

  errors.invalidToken = function () {
    return errors.wrap({
      code: 401,
      errno: 110,
      message: 'Invalid authentication token in request signature'
    })
  }

  errors.invalidTimestamp = function () {
    return errors.wrap({
      code: 401,
      errno: 111,
      message: 'Invalid timestamp in request signature',
      serverTime: Math.floor(+new Date() / 1000)
    })
  }

  errors.invalidNonce = function () {
    return errors.wrap({
      code: 401,
      errno: 115,
      message: 'Invalid nonce in request signature'
    })
  }

  errors.missingContentLength = function () {
    return errors.wrap({
      code: 411,
      errno: 112,
      message: 'Missing content-length header'
    })
  }

  errors.requestBodyTooLarge = function () {
    return errors.wrap({
      code: 413,
      errno: 113,
      message: 'Request body too large'
    })
  }

  errors.tooManyRequests = function () {
    return errors.wrap({
      code: 429,
      errno: 114,
      message: 'Client has sent too many requests',
      retryAfter: 30
    })
  }

  errors.serviceUnavailable = function () {
    return errors.wrap({
      code: 503,
      errno: 201,
      message: 'Service unavailable',
      retryAfter: 30
    })
  }

  return errors
}
