hapi-stateless-notifications
============================

A plugin to give a hapi `reply` a `reply.saveNotifications()` method that collect non-fatal errors and store them long enough to display on later pages, given the token.

Use
-----

// step 0: set up a plugin that gives a request.redis property that's a client connection, ready to use for this request.

server.register(require('hapi-stateless-notifications'));



