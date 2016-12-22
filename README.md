hapi-stateless-notifications
============================

A plugin to handle saving notifications to pass to a following page, so you can redirect after post and all those niceties without having to fall back to session-associated flash messages.

Use
-----

```
// step 0: set up a plugin that gives a request.redis property that's a
// client connection, ready to use for this request. We steal the
// connection from `catbox-redis`.

server.register({
    register: require('hapi-stateless-notifications'),
    options: {
        queryParameter: 'notice',
        prefix: 'notice:',
        timeout: 3600
    }
});
```

The `options` are optional.

`options.queryParameter` controls which query parameter will cause the plugin to look up a token and defaults to `'notice'`
`options.prefix` controls the key prefix in redis, and defaults to `'notice:'`
`options.timeout` controls the the expiration timeout of the key in redis, in seconds. The default is `3600`, that is, one hour.

Then in a handler:

```
reply.saveNotifications([
    Promise.resolve('Success message here ...'),
    Promise.reject(new Error('Error message here ...')),
]).then(function (token) {
    // if there's a token, put it in the query of the page you load next as `notice={token}`
    // Otherwise, there's nothing to do.
});
```

Or more completely:

```
reply.redirectAndNotify([
    Promise.resolve('Success message here ...'),
    Promise.reject(new Error('Error message here ...')),
], '/next-page')
```

or if the failure path leads a different place:

```
reply.redirectAndNotify([
    Promise.resolve('Success message here ...'),
    Promise.reject(new Error('Error message here ...')),
], { success: '/next-page', failure: '/this-page' })
```
