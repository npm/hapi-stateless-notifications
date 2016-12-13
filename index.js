"use strict";

var P = require('bluebird');
var TokenFacilitator = require('token-facilitator');
var debug = require('debuglog')('hapi-stateless-notifications');
var url = require('url');
var ignoreErrors = [EvalError, RangeError, ReferenceError, SyntaxError, TypeError];

exports.register = function(server, options, next) {
  options = options || {};

  debug("Registering plugin");

  server.ext('onPreHandler', function(request, reply) {

    if (!request.redis) {
      throw new Error("request.redis is not defined; set up a plugin that provides that");
    }

    request.saveNotifications = function(promises) {
      // Legacy API
      return reply.saveNotifications(promises).then(function (data) {
        return data.token
      });
    };

    return reply.continue();
  });

  server.decorate('reply', 'saveNotifications', function (promises) {
    var self = this;

    return P.all(promises.map(function(promise) {
      return P.resolve(promise).then(function(successNotice) {
        debug("Success '%s' for request '%s'", successNotice, self.request.id);
        return P.resolve({
          notice: successNotice,
          type: 'success'
        });
      }).catch(function(error) {
        if ((!error.statusCode && ignoreErrors.indexOf(error.constructor) != -1) || error.statusCode >= 500) {
          throw error;
        }
        debug("Error '%s' for request '%s'", error.message, self.request.id);
        return P.resolve({
          notice: error.message,
          type: 'error'
        });
      });
    })).then(function (notices) {
      var anyFailed = notices.some(function (n) {
        return n.type == 'error';
      });

      return putNoticesInRedis(self.request.redis, notices, options).then(function (token) {
        debug("Saved to redis for '%s' with token '%s'", self.request.id, token);
        return { token: token, success: !anyFailed };
      });
    }, function (err) {
      debug("Error saving to redis for '%s'", self.request.id);
      throw err;
    });
  });

  server.decorate('reply', 'redirectAndNotify', function (promises, targetUrl) {
    promises = [].concat(promises);
    var self = this;

    return this.saveNotifications(promises)
      .then(function (result) {
        if (typeof targetUrl == 'object') {
          targetUrl = targetUrl[result.success ? 'success' : 'failure'];
        }

        var target = url.parse(targetUrl, true);
        delete target.search; // url.parse and url.format are kind awful

        if (result.token) {
          target.query.notice = result.token
        }

        self.redirect(url.format(target));
      })
  });


  server.ext('onPreResponse', function(request, reply) {
    if (request.query[options.queryParameter || 'notice']) {

      request.logger.info("checking for notices", request.query.notice);

      var facilitator = new TokenFacilitator({redis: request.redis});

      P.promisify(facilitator.read, {context: facilitator})(request.query.notice, {
        prefix: options.prefix || 'notice:'
      }).then(function(data) {
        if (!data || !data.notices || !data.notices.length) {
          request.logger.info("No notices");
          return;
        }

        request.logger.info("Found notices", data);

        if (request.response.variety === 'view') {
            if (!request.response.source) {
                request.response.source = {};
            }

            if (!request.response.source.context) {
                request.response.source.context = {};
            }

            var notices = data.notices.filter(function(notice){
              return typeof notice.notice !== "undefined" && !!notice.notice;
            });

            Object.assign(request.response.source.context, {
              errorNotices: notices.filter(function(notice) {
                return notice.type === 'error';
              }).map(function(notice) {
                return notice.notice;
              }),
              successNotices: notices.filter(function(notice) {
                return notice.type === 'success';
              }).map(function(notice) {
                return notice.notice;
              })
            });
        }
      }).catch(function(e) {
        request.logger.error(e);
        throw e;
      }).then(function() {
        reply.continue();
      }, reply).done();
    } else {
      reply.continue();
    }

  });

  return next();
};

function putNoticesInRedis(redis, notices, options) {
  if (notices.length) {
    var facilitator = new TokenFacilitator({
      redis: redis
    });
    return P.promisify(facilitator.generate, {context: facilitator})({notices: notices}, {
      timeout: options.timeout || 3600,
      prefix: options.prefix || 'notice:'
    });
  }
}

exports.register.attributes = {
  pkg: require('./package.json')
};
