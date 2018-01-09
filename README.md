# koa-git-smart-proxy

A proxy library for custom git deploy logic made for koa.

## Install

```sh
npm install --save koa-git-smart-proxy
```

## Why?

Looking at existing git deployment libraries for node, not many have good compatibility with [koa](https://www.npmjs.com/package/koa). So instead of creating a compatibility layer for my application, I created a new library made just for [koa](https://www.npmjs.com/package/koa).

I took insparation from existing packages for node;
[pushover](https://github.com/substack/pushover),
[git-http-backend](https://github.com/substack/git-http-backend),
gems for ruby;
[grack](https://github.com/schacon/grack)
and the
[http protocol documentation for git](https://github.com/git/git/blob/master/Documentation/technical/http-protocol.txt).

## Usage

### Basic usage (without auto-deployment)

```js

const koa = require('koa');
const HttpStatus = ('http-status');
const { middleware, ServiceType } = require('koa-git-smart-proxy');

// Path to git executable
const executable_path = 'git';
// Repositories root folder
const root_folder = process.env.GIT_ROOT;

// Create app
const app = new koa;

// Attach proxy
app.use(middleware({
  git: root_folder,
}));

// Git services
app.use(ctx => {
  const {proxy} = ctx.state;

  // Not found
  if (!proxy.repository) {
    return proxy.reject(HttpStatus.NOT_FOUND);
  }

  // Forbidden
  if (proxy.service=!== ServiceType.UNKNOWN) {
    return proxy.reject(HttpStatus.FORBIDDEN);
  }

  // Accept
  return proxy.accept();
});

```

### Auto-deployment

Auto deployment accepts or rejects a request if no action is taken further down the middleware chain. The options is **off by default**.

Set the `auto_deploy` option to `true` to accept, or `false` to reject not handled requests. It also has a default reject logic independent of the flag value, and works simular to the below code.

```js
// Not found
if (!proxy.repository) {
  return proxy.reject(404);
}

// Forbidden
if (proxy.service !== ServiceType.UNKNOWN) {
  return proxy.reject(403);
}

// Accept/Reject
return auto_deploy? proxy.accept() : proxy.reject();
```

So if you set `auto_deploy` to `true`, you can shrink the basic example down to:

```js
const koa = require('koa');
const { middleware } = require('koa-git-smart-proxy');

// Repositories root folder
const root_folder = process.env.GIT_ROOT;

// Create app
const app = new koa;

// Attach proxy and respond to requests
app.use(middleware({git: root_folder, auto_deploy: true}));
```

### Custom authentication/authorization example

You got a user system where you want to restrict some services?
In the below example, we authenticate with HTTP Basic Authenticatoin and
check if both repo exist and service is available for user (or non-user).

```js
const koa = require('koa');
const passport = require('koa-passport');
const HttpStatus = ('http-status');
const { match } = require('koa-match');
const { middleware, ServiceType } = require('koa-git-smart-proxy');
const Models = require('./models');

// Get root folder
const root_folder = process.env.GIT_ROOT;

// Create app
const app = new koa;

/* ... some more logic ... */

// Git services
app.use(match({
  path: ':username/:repository.git/:path(.*)?',
  handlers: [
    // Authenticate client
    passport.initialize(),
    passport.authenticate('basic'),

    // Get repository
    async(ctx, next) => {
      const {username, repository} = ctx.params;

      const repo = await Models.Repository.findByOwnerAndName(username, repository);

      if (repo) {
        ctx.state.repo = repo;
      }

      return next();
    },

    // Attach proxy
    middleware({git: {root_folder} }),

    // Validation
    async(ctx) => {
      const {proxy, repo, user} = ctx.state;
      const {username, repository, path} = ctx.params;

      // Redirect
      if (!path) {
        return ctx.redirect('back', `/${username}/${repository}/`);
      }

      // Not found
      if (!repo) {
        return proxy.reject(HttpStatus.NOT_FOUND);
      }

      // Unknown service
      if (proxy.service === ServiceType.UNKNOWN) {
        return proxy.reject(HttpStatus.FORBIDDEN);
      }

      // Unautrorized access
      if (!await repo.checkService(proxy.service, user)) {
        ctx.set('www-authenticate', `Basic`);
        return proxy.reject(HttpStatus.UNAUTHORIZED);
      }

      // Repos are stored differently than url structure.
      const repo_path = await repo.get_path();

      // #accept can be supplied with an absolute path
      // or a path relative to root_folder.
      return proxy.accept(repo_path);
    }
  ]
}));

/* ... maybe some more logic? ... */
```

### Custom git handler

We only need a connection to stdin and stdout from the git process. How you spawn is up to you.

```js
const custom_command = function git_input_output(repository, command, command_arguments) {
  let output; // Readable stream
  let input; // Writable stream

  /* some magical logic to set input/output */

  return {output, input};
}

app.use(middleware({
  git: custom_command,
}));
```

## Typescript

This module includes a [TypeScript](https://www.typescriptlang.org/)
declaration file to enable auto complete in compatible editors and type
information for TypeScript projects. This module depends on the Node.js
types, so install `@types/node`:

```sh
npm install --save-dev @types/node
```

## License
Licensed under the MIT License, see [LICENSE](./LICENSE).
