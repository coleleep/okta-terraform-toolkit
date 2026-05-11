const path = require('path');

module.exports = {
  mode: 'development',
  entry: './src/main/index.ts',
  target: 'electron-main',
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    path: path.resolve(__dirname, 'dist/main'),
    filename: 'index.js',
  },
  externals: {
    'jsonwebtoken': 'commonjs jsonwebtoken',
    '@anthropic-ai/sdk': 'commonjs @anthropic-ai/sdk',
  },
};
