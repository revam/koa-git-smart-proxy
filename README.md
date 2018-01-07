# koa-git-proxy

A proxy library for custom git deploy logic for koa.

## Install

```sh
npm install --save koa-git-proxy
```

## Why

Looking at exsisting git deploy libraries, not many are natively compatible with [koa](https://www.npmjs.com/package/koa). So instead of adding a comatibaly layer to my app, I created my own library compatible with [koa](https://www.npmjs.com/package/koa).

I took insparation from existing packages for node;
[pushover](https://github.com/substack/pushover),
[git-http-backend](https://github.com/substack/git-http-backend),
and gems for ruby;
[grack](https://github.com/schacon/grack).

## Usage

Basic usage example.

```js

const koa = require('koa');
const HttpStatus = ('http-status');
const { GitProxy, ServiceType } = require('koa-git-proxy');

// Root folder
const root_folder = process.env.GIT_ROOT;

const app = new koa;

// Attach proxy
app.use(GitProxy.middleware());

// Git services
app.use(ctx => {
  const {proxy} = ctx.state;

  // Not found
  if (!proxy.repository) {
    return proxy.reject(HttpStatus.NOT_FOUND);
  }

  // Bad request
  if (proxy.service=!== ServiceType.UNKNOWN) {
    return proxy.reject(HttpStatus.BAD_REQUEST);
  }

  // Accept
  return proxy.accept();
});

```

Custom authentication/authorization example.

```js
// import from packages
const koa = require('koa');
const passport = require('koa-passport');
const HttpStatus = ('http-status');
const { match } = require('koa-match');
const { GitProxy, ServiceType } = require('koa-git-proxy');
// import from library
const middleware = require('./middleware');
const Models = require('./models');

// Create app
const app = new koa;

/* ... some more logic ... */

// Git services
app.use(match({
  path: ':username/:repository.git/:path(.*)?',
  handlers: [
    ...middleware,

    // Authenticate user
    passport.authenticate('basic'),

    async(ctx, next) => {
      const {username, repository} = ctx.params;

      const repo = await Models.Repository.findByOwnerAndName(username, repository);

      if (repo) {
        ctx.state.repo = repo;
      }

      return next();
    },

    // Attach proxy
    GitProxy.middleware(),

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

      // Bad request
      if (proxy.service === ServiceType.UNKNOWN) {
        return proxy.reject(HttpStatus.BAD_REQUEST);
      }

      // Unautrorized access
      if (!await repo.checkService(proxy.service, user)) {
        ctx.set('www-authenticate', `Basic`);
        return proxy.reject(HttpStatus.UNAUTHORIZED);
      }

      // Accept
      // Can be supplied with an absolute path
      // or another path relative to root_folder.
      return proxy.accept(await repo.get_path());
    }
  ]
}));

/* ... maybe some more logic? ... */

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
