module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['dist', 'tests/utils'],
  moduleNameMapper: {
    'js-combinatorics': '<rootDir>/node_modules/js-combinatorics/commonjs/combinatorics.js'
  }
};
