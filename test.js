"use strict";
const test = require('tap').test;
const redis = require('redis');
const Hapi = require('hapi');
const Vision = require('vision');
const noticePlugin = require('./');
const Promise = require('bluebird');
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
            t.equal(renderedNotices.length, 2);
        }));

});


