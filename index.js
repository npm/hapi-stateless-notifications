var P = require('bluebird');
var TokenFacilitator = require('token-facilitator');
var crypto = require('crypto');
var debug = require('debuglog')('hapi-stateless-notifications');

exports.register = function(server, options, next) {
  options = options || {};

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

  server.ext('onPreResponse', function(request, reply) {
    if (request.query[options.queryParameter || 'notice']) {

      request.logger.info("checking for notices", request.query.notice);

      var facilitator = new TokenFacilitator({redis: request.redis});

      facilitator.read(request.query.notice, {
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
      return facilitator.generate({notices: notices}, {
        timeout: options.timeout || 3600,
        prefix: options.prefix || 'notice:'
      });
    }
  };
}

exports.register.attributes = {
  pkg: require('./package.json')
};
