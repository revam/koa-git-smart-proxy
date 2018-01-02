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
          files.push(`${base}.d.ts`);
          files.push(`${base}.js`);
          files.push(`${base}.js.map`);
          if (basedir) {
            base = join(new_root, basedir) + sep;
            if (!folders.includes(base)) {
              folders.push(base);
            }
          }
        }
      }

      folders.sort((a, b) => b - a);

      console.log(files);
      console.log(folders);

      // Remove files generated from typescript source
      await Promise.all(files.map(async(file) => {
        if (await promisify(fs.exists)(file)) {
          await promisify(fs.unlink)(file);
        }
      }));

      // Remove empty folders
      await Promise.all(folders.map(async(folder) => {
        if (!(await promisify(fs.readdir)(folder)).length) {
          await promisify(fs.rmdir)(folder);
        }
      }));

      done();
    })()
    .catch(e => console.error(e));
  });
};
