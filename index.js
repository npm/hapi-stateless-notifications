"use strict";

var P = require('bluebird');
var TokenFacilitator = require('token-facilitator');
var debug = require('debuglog')('hapi-stateless-notifications');
var url = require('url');

exports.register = function(server, options, next) {
  options = options || {};

  debug("Registering plugin");

  server.ext('onPreHandler', function(request, reply) {

    if (!request.redis) {
      throw new Error("request.redis is not defined; set up a plugin that provides that");
    }

    request.saveNotifications = function(promises) {
      return P.all(promises.map(function(promise) {
        return P.resolve(promise).then(function(successNotice) {
          debug("Success '%s' for request '%s'", successNotice, request.id);
          return P.resolve({
            notice: successNotice,
            type: 'success'
          });
        }).catch(function(error) {
          if ((!error.statusCode && error.constructor != Error) || error.statusCode >= 500) {
            throw error;
          }
          debug("Error '%s' for request '%s'", error.message, request.id);
          return P.resolve({
            notice: error.message,
            type: 'error'
          });
        });
      })).then(putNoticesInRedis(request.redis, options)).then(function (token) {
        debug("Saved to redis for '%s' with token '%s'", request.id, token);
        return token;
      }, function (err) {
        debug("Error saving to redis for '%s'", request.id);
        throw err;
      });
    };

    return reply.continue();
  });

  server.decorate('reply', 'saveNotifications', function (promises) {
    return this.request.saveNotifications(promises);
  });

  server.decorate('reply', 'redirectAndNotify', function (promises, targetUrl) {
    promises = [].concat(promises);
    var target = url.parse(targetUrl, true);
    delete target.search; // url.parse and url.format are kind awful
    var self = this;

    return this.saveNotifications(promises)
      .then(function (token) {
        if (token) {
          target.query.notice = token
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

function putNoticesInRedis(redis, options) {
  return function(notices) {
    if (notices.length) {
      var facilitator = new TokenFacilitator({
        redis: redis
      });
      return P.promisify(facilitator.generate, {context: facilitator})({notices: notices}, {
        timeout: options.timeout || 3600,
        prefix: options.prefix || 'notice:'
      });
    }
  };
}

exports.register.attributes = {
  pkg: require('./package.json')
};
