const {resolve, join, sep, extname: _extname, basename: _basename} = require('path');
const {readdirSync, statSync} = require('fs');

module.exports = {
  *iteratedir(rootpath) {
   const paths = [''];
   const rootdir = resolve(rootpath);

   do {
     const basedir = paths.pop();

     for (const entry of readdirSync(resolve(rootdir, basedir))) {
       const basepath = `.${sep}${join(basedir, entry)}`;
       const fullpath = join(rootdir, basepath);
       const info = statSync(fullpath);

       if (info.isDirectory()) {
         paths.push(basepath);
       }

       else if (info.isFile()) {
         const extname = _extname(entry);
         const basename = _basename(entry, extname);

         yield {rootdir, basedir, basepath, fullpath, entry, basename, extname};
       }
     }
   }
   while (paths.length);
  },
}

