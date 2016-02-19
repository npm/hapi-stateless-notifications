var test = require('tap').test;
var redis = require('redis');
var Hapi = require('hapi');
var noticePlugin = require('./');
var Promise = require('bluebird');

test('does it work?', function (t) {
    var client = redis.createClient(6379, '127.0.0.1');

    var server = new Hapi.Server();
    server.connection({ autoListen: false });
    server.views({
        engines: {
            hbs: require('handlebars')
        },
        relativeTo: __dirname,
        path: './test-templates',
        layoutPath: './test-templates'
    });

    server.route([
        {
            method: 'GET',
            path: '/1',
            handler: function (request, reply) {
                t.ok(request.saveNotifications, 'found method');

                request.saveNotifications([
                    Promise.resolve('yay'),
                    Promise.reject(new Error('boom')),
                    Promise.reject(new Error('')),
                    Promise.resolve(),
                ]).then(function (token) {
                    t.ok(token, 'got token');
                    reply(token);
                }).catch(function (err) {
                    t.error(err);
                    reply(err);
                });
            }
        },
        {
            method: 'GET',
            path: '/2',
            handler: function (request, reply) {
                t.ok(request.query.notice, 'got param');
                reply.view('notices');
            }
        }
    ]);

    function setup(server, options, next) {
        server.ext('onPreHandler', function (request, reply) {
            request.redis = client;
            request.logger = {
                info: function() {
                },
                error: t.fail
            };
            reply.continue();
        });

        next();
    }

    setup.attributes = {
        name: 'setup'
    };

    server.register([
        setup,
        noticePlugin
    ], function (err) {
        server.inject({ method: 'GET', url: '/1' }, function (res) {
            var token = res.result;
            t.ok(token);
            server.inject({ method: "GET", url: '/2?notice=' + token}, function (res) {
                var renderedNotices = res.result.trim().split('\n').map(function(value) {
                    return value.trim();
                })
                t.equal(renderedNotices[0], 'success notice: yay');
                t.equal(renderedNotices[1], 'error notice: boom');
                t.equal(renderedNotices.length, 2);
                server.stop();
                client.quit();
                t.end();
            });
        });
    });

});


