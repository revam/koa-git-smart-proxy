# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added missing usage example for `middlware( [options] )`.

### Changed

- Changed ref metadata. (Combined all into one.)
- Set cwd before executing commands (in default handler).
- Tweaked middleware.
- Typos in some comments.
- Moved used function from 'src/helper.ts' to 'src/source.ts'.

### Fixed

- Error matching non-route. (returned undefined)
- Usage examples for both static methods.

### Removed

- Unused code in middleware example.
- Removed unused helper functions.

## 0.0.1 - 2018-01-12

### Added

- Initial dev release. Still unstable.

[Unreleased]: https://github.com/olivierlacan/keep-a-changelog/compare/v0.0.1...HEAD
[0.0.2]: https://github.com/revam/git-koa-smart-proxy/compare/v0.0.1...v0.0.2
