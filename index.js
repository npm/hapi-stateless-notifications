var P = require('bluebird');
var TokenFacilitator = require('token-facilitator');
var collectFailures = require('promise.allrejected');
var crypto = require('crypto');
var bole = require('bole');

exports.register = function(server, options, next) {
  options = options || {};

  server.ext('onPreHandler', function(request, reply) {

    if (!request.redis) {
      throw new Error("request.redis is not defined; set up a plugin that provides that");
    }

    request.saveNotifications = function(promises) {
      return collectFailures(promises).then(putErrorsInRedis(request.redis, options));
    };

    return reply.continue();
  });

  server.ext('onPreResponse', function(request, reply) {
    if (request.query.notice) {
      if (!request.redis) {
        throw new Error("request.redis is not defined; set up a plugin that provides that");
      }

      var logger = bole(request.id);

      logger.info("checking for notices", request.query.notice);

      var facilitator = new TokenFacilitator({
        redis: request.redis
      });

      P.promisify(facilitator.read, facilitator)(request.query.notice, {
        prefix: options.prefix || 'notice:'
      }).then(function(data) {
        if (!data || !data.notices || !data.notices.length) {
          logger.info("No notices");
          return;
        }

        logger.info("Found notices", data);

        if (request.response.variety === 'view') {
          if (!request.response.source) {
            request.response.source = {};
          }

          if (!request.response.source.context) {
            request.response.source.context = {};
          }

          request.response.source.context.notices = data.notices;
        }
      }).catch(function(e) {
        logger.error(e);
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

function putErrorsInRedis(redis, options) {
  return function(errors) {
    if (errors.length) {
      var facilitator = new TokenFacilitator({
        redis: redis
      });
      return P.promisify(facilitator.generate, facilitator)({
        notices: errors
      }, {
        timeout: options.timeout || 3600,
        prefix: options.prefix || 'notice:'
      });
    }
  };
}

exports.register.attributes = {
  pkg: require('./package.json')
};
