var P = require('bluebird');
var TokenFacilitator = require('token-facilitator');
var collectFailures = require('promise.allrejected');
var crypto = require('crypto');

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

      var hash = crypto.createHash('sha1').update(request.query.notice).digest('hex');
      P.promisify(request.redis.get, request.redis)('notice:' + hash ).then(function(e) {
        var data = JSON.parse(e);

        if (!data) {
            request.logger.info("No notices");
            return;
        }

        if (data.token != request.query.notice) {
          throw new VError("Token mismatch: %j vs %j", data.token, request.query.notice);
        }

        request.logger.info("Found notices", data);

        request.response.source.context.notices = data.notices;
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
