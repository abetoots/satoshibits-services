export default {
  // Lint staged passes the filenames as an argument to the command
  // If you want to pass --project to tsc, use the arrow function syntax
  // Note: Using project will defeat the purpose of lint-staged
  //since it will type check files specified in tsconfig.json, not just the staged ones
  //see: https://github.com/lint-staged/lint-staged/issues/825
  "*.{js,ts,mts,mjs}": ["eslint --fix", "./tsc-lintstaged.sh"],
};
