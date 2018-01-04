// from packages
import { exists, readdir, rmdir, unlink } from 'fs';
import { join, resolve, sep } from 'path';
import { promisify } from 'util';
// from library
import { iteratedir } from './util';

// tslint:disable-next-line
import 'ts-node/register';

export = (grunt: IGrunt) => {
  const tsconfig = grunt.file.readJSON('./tsconfig.json');

  grunt.initConfig({
    mocha: {
      default: {
        src: [
          'test/**/*.test.ts',
        ],
      },
    },
    ts: {
      default: {
        // specifying tsconfig as an object allows detailed configuration overrides...
        tsconfig: {
          passThrough: true,
        },
      },
    },
    tslint: {
      default: {
        src: [
          'src/**/*.ts',
        ],
      },
      options: {
        // can be a configuration object or a filepath to tslint.json
        configuration: "tslint.json",
        // If set to true, tslint errors will be reported, but not fail the task
        // If set to false, tslint errors will be reported, and the task will fail
        fix: false,
        force: false,
      },
    },
  });

  grunt.loadNpmTasks('grunt-ts');
  grunt.loadNpmTasks('grunt-tslint');
  grunt.loadNpmTasks('grunt-mocha');

  grunt.registerTask('cleanup', 'Removes production files', function() {
    // Force task into async mode and grab a handle to the "done" function.
    const done = this.async();

    (async(_resolve) => {
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

      grunt.log.verbose.writeln(`Removing ${files.length} files`);

      // Remove files generated from typescript source (in parallel)
      await Promise.all(files.map(async(file) => {
        if (await promisify(exists)(file)) {
          grunt.log.verbose.writeln(`Removing file: '${file}'`);
          await promisify(unlink)(file);
        }
      }));

      // Delete longest paths first
      folders.sort((a, b) => b - a);

      // Remove empty folders (in parallel)
      await Promise.all(folders.map(async(folder) => {
        if (
          await promisify(exists)(folder) && ! (
          await promisify(readdir)(folder)).length
        ) {
          grunt.log.verbose.writeln(`Removing empty folder: '${folder}'`);
          await promisify(rmdir)(folder);
        }
      }));

      done();
    })()
    .catch(done);
  });

  grunt.registerTask('lint', ['tslint']);
  grunt.registerTask('test', ['mocha']);
  grunt.registerTask('build', ['ts']);

  grunt.registerTask('prelint', []);
  grunt.registerTask('pretest', []);
  grunt.registerTask('prebuild', []);
  grunt.registerTask('prepublish', []);
  grunt.registerTask('postpublish', ['cleanup']);
};
