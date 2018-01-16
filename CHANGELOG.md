# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2018-01-16

### Added

- More usage examples

### Fixed

- Broken links

## [1.0.0] - 2018-01-16

### Added

- Missing usage examples.
- Missing method `GitSmartProxy#exists([alternative_path])`

### Changed

- Using package `'git-smart-proxy-core'`. Removed `source.ts`
- Updated [README.md](./README.md) to reflect changes.
- Internal overhaul, many changes to internal api.
- Changed metadata. (Combined all ref data into one.)
- Tweaked middleware.

### Fixed

- Error matching non-route. (returned undefined)
- Usage examples for both static methods.
- Incorrect test (should just pipe output when no input, but don't inspect it.) for GitStream.

### Removed

## 0.0.1 - 2018-01-12

### Added

- Initial dev release. Still unstable.

[Unreleased]: https://github.com/olivierlacan/keep-a-changelog/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/revam/git-koa-smart-proxy/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/revam/git-koa-smart-proxy/compare/v0.0.1...v1.0.0
