const {join, resolve, sep} = require('path');
const fs = require('fs');
const {promisify} = require('util');
const {iteratedir} = require('./util');
const tsconfig = require('./tsconfig.json');

module.exports = function(grunt) {
  grunt.initConfig({

  });

  grunt.registerTask('del-dist', 'Removes built files', function() {
    // Force task into async mode and grab a handle to the "done" function.
    const done = this.async();

    (async(resolve) => {
      const files = [];
      const folders = [];
      const new_root = join(process.cwd(), tsconfig.compilerOptions.outDir);
      for (const {rootdir, basedir, basepath, fullpath, entry, basename, extname} of iteratedir('src')) {
        if ('.ts' === extname) {
          let base = join(new_root, fullpath.slice(rootdir.length, -(extname.length)));
          files.push(`${base}.d.ts`, `${base}.js`, `${base}.js.map`);

          if (basedir.length > 2) {
            base = join(new_root, basedir) + sep;
            if (!folders.includes(base)) {
              folders.push(base);
            }
          }
        }
      }

      grunt.verbose.writeln(`Removing ${files.length} files`);

      // Remove files generated from typescript source (in parallel)
      await Promise.all(files.map(async(file) => {
        if (await promisify(fs.exists)(file)) {
          grunt.verbose.writeln(`Removing file: '${file}'`);
          await promisify(fs.unlink)(file);
        }
      }));

      // Delete longest paths first
      folders.sort((a, b) => b - a);

      // Remove empty folders (in parallel)
      await Promise.all(folders.map(async(folder) => {
        if (
          await promisify(fs.exists)(folder) && ! (
          await promisify(fs.readdir)(folder) ).length
        ) {
          grunt.verbose.writeln(`Removing empty folder: '${folder}'`);
          await promisify(fs.rmdir)(folder);
        }
      }));

      done();
    })()
    .catch(e => console.error(e));
  });
};
