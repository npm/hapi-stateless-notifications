hapi-stateless-notifications
============================

A plugin to give a hapi `reply` a `reply.saveNotifications()` method that collect non-fatal errors and store them long enough to display on later pages, given the token.

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
request.saveNotifications([
    Promise.reject("Error message here")
]).then(function (token) {
    // if there's a token, put it in the query of the page you load next as `notice={token}`
    // Otherwise, there's nothing to do.
});
```

Any rejected promises will be collected and their error messages displayed.
Successful promises (and plain values) are ignored.

V2 may separate "store these bits of text" and "collect some failed promises"
but for now they're a single interface.
