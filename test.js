"use strict";
const test = require('tap').test;
const redis = require('redis');
const Hapi = require('hapi');
const Vision = require('vision');
const noticePlugin = require('./');
const Promise = require('bluebird');
const url = require('url');
const withFixtures = require('with-fixtures');

test('does it work?', t => {
    const client = redis.createClient(6379, '127.0.0.1');

    const server = new Hapi.Server();
    server.connection({ autoListen: false });

    server.route([
        {
            method: 'GET',
            path: '/basic',
            handler: (request, reply) => {
                t.ok(reply.saveNotifications, 'found method');

                reply.saveNotifications([
                    Promise.resolve('yay'),
                    Promise.reject(new Error('boom')),
                    Promise.reject(new Error('')),
                    Promise.reject(Object.assign(new Error('404'), { statusCode: 404 })),
                    Promise.resolve(),
                ]).then(token => {
                    t.ok(token, 'got token');
                    reply(token);
                }).catch(err => {
                    t.error(err);
                    reply(err);
                });
            }
        },
        {
            method: 'GET',
            path: '/redirect',
            handler: (request, reply) => {
                t.ok(reply.redirectAndNotify, 'found method');

                reply.redirectAndNotify([
                    Promise.resolve('yay'),
                    Promise.reject(new Error('boom')),
                    Promise.reject(new Error('')),
                    Promise.resolve(),
                ], '/fetch?test=yes')
                    .catch(err => {
                        t.error(err);
                        reply(err);
                    });
            }
        },
        {
            method: 'GET',
            path: '/type-error',
            handler: (request, reply) => {
                reply.redirectAndNotify([
                    Promise.resolve('yay'),
                    Promise.reject(new TypeError('boom')),
                    Promise.reject(new Error('')),
                    Promise.resolve(),
                ], '/fetch?test=yes')
                .then(() => {
                    t.fail("not expecting success")
                    reply("Fail");
                }, err => {
                    reply(err);
                });
            }
        },
        {
            method: 'GET',
            path: '/500-error',
            handler: (request, reply) => {
                reply.redirectAndNotify([
                    Promise.resolve('yay'),
                    Promise.reject(Object.assign(new Error('boom'), { statusCode: 500 })),
                    Promise.reject(new Error('')),
                    Promise.resolve(),
                ], '/fetch?test=yes')
                .then(() => {
                    t.fail("not expecting success")
                    reply("Fail");
                }, err => {
                    reply(err);
                });
            }
        },
        {
            method: 'GET',
            path: '/fetch',
            handler: (request, reply) => {
                t.ok(request.query.notice, 'got param');
                reply.view('notices');
            }
        }
    ]);

    function setup(server, options, next) {
        server.ext('onPreHandler', (request, reply) => {
            request.redis = client;
            request.logger = {
                info: () => {},
                error: t.fail
            };
            reply.continue();
        });

        next();
    }

    setup.attributes = {
        name: 'setup'
    };

    const cleanup = {
        done() {
            server.stop();
            client.quit();
        }
    };

    return withFixtures([cleanup], () => server.register([
        Vision,
        setup,
        noticePlugin
    ])
        .then(() => server.views({
            engines: {
                hbs: require('handlebars')
            },
            relativeTo: __dirname,
            path: './test-templates',
            layoutPath: './test-templates'
        }))
        .then(() => server.inject({ method: 'GET', url: '/basic' }))
        .then(res => {
            const token = res.result;
            t.ok(token, 'got token');
            return server.inject({ method: "GET", url: '/fetch?notice=' + token})
        })
        .then(res => {
            const renderedNotices = res.result.trim().split('\n').map(value => value.trim())
            t.equal(renderedNotices[0], 'success notice: yay');
            t.equal(renderedNotices[1], 'error notice: boom');
            t.equal(renderedNotices[2], 'error notice: 404');
            t.equal(renderedNotices.length, 3);
        })
        .then(() => server.inject('/redirect'))
        .then(res => {
            t.equal(res.statusCode, 302);
            const token = url.parse(res.headers.location, true).query.notice;
            t.ok(token, 'got token from redirect');
            return server.inject({ method: "GET", url: '/fetch?notice=' + token})
        })
        .then(res => {
            const renderedNotices = res.result.trim().split('\n').map(value => value.trim())
            t.equal(renderedNotices[0], 'success notice: yay');
            t.equal(renderedNotices[1], 'error notice: boom');
            t.equal(renderedNotices.length, 2);
        })
        .then(() => server.inject('/type-error'))
        .then(res => {
            t.equal(res.statusCode, 500);
        })
        .then(() => server.inject('/500-error'))
        .then(res => {
            t.equal(res.statusCode, 500);
        }))

});
