module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.spec.json',
      },
    ],
  },
  moduleNameMapper: {
    '^@aiecom/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@aiecom/collector-core$': '<rootDir>/../../packages/collector-core/src/index.ts',
    '^@aiecom/llm-core$': '<rootDir>/../../packages/llm-core/src/index.ts',
    '^@aiecom/platform-core$': '<rootDir>/../../packages/platform-core/src/index.ts',
  },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};
